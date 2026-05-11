let _password = "";

export function setAuthPassword(p) {
  _password = p;
}

export async function apiFetch(path) {
  const headers = _password ? { "x-auth-password": _password } : {};
  const res = await fetch(path, { cache: "no-store", headers });
  if (res.status === 401) {
    const err = new Error("Auth required");
    err.code = 401;
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchConfig() {
  return apiFetch("/api/config");
}

// CORS proxies used as browser-side fallback when the server can't reach Yahoo Finance
// (cloud datacenter IPs are blocked by Yahoo Finance's WAF).
const CORS_PROXIES = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

export async function fetchOHLC(symbol, range, interval) {
  // 1. Try server-side proxy (preferred: no CORS limits, keeps Yahoo auth server-side)
  try {
    const params = new URLSearchParams({ symbol, range, interval });
    const data = await apiFetch(`/api/quote?${params}`);
    return parseYfChart(data, symbol);
  } catch (e) {
    if (e.code === 401) throw e; // auth error — surface immediately
    // Server proxy failed (Railway IP blocked, etc.) — fall through to browser fetch
  }

  // 2. Browser-direct via CORS proxy (browser IP is not blocked by Yahoo Finance)
  const yfUrl =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}&includePrePost=false`;

  let lastErr = new Error("All data sources failed");
  for (const proxy of CORS_PROXIES) {
    try {
      const res = await fetch(proxy(yfUrl), { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      return parseYfChart(data, symbol);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function parseYfChart(data, symbol) {
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data returned for ${symbol}`);

  const meta = result.meta || {};
  const ts   = result.timestamp || [];
  const q    = result.indicators?.quote?.[0] || {};

  const out = { times: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };

  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] == null) continue;
    out.times.push(ts[i] * 1000);
    out.opens.push(q.open[i]);
    out.highs.push(q.high[i]);
    out.lows.push(q.low[i]);
    out.closes.push(q.close[i]);
    out.volumes.push(q.volume[i] || 0);
  }

  out.meta = {
    symbol:    meta.symbol,
    name:      meta.longName || meta.shortName || meta.symbol,
    price:     meta.regularMarketPrice,
    prevClose: meta.chartPreviousClose ?? meta.previousClose,
    currency:  meta.currency || "USD",
    exchange:  meta.exchangeName || meta.fullExchangeName || "",
  };

  return out;
}
