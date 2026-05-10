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

/**
 * Fetch OHLC bars from Yahoo Finance (proxied through local Express server).
 *
 * @param {string} symbol  e.g. "AAPL", "^GSPC", "BTC-USD"
 * @param {string} range   "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "5y" | "max"
 * @param {string} interval "1m" | "5m" | "15m" | "1h" | "1d" | "1wk" | "1mo"
 * @returns {Promise<{
 *   times: number[], opens: number[], highs: number[], lows: number[],
 *   closes: number[], volumes: number[],
 *   meta: { symbol, name, price, prevClose, currency, exchange }
 * }>}
 */
export async function fetchOHLC(symbol, range, interval) {
  const params = new URLSearchParams({ symbol, range, interval });
  const data = await apiFetch(`/api/quote?${params}`);

  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data returned for ${symbol}`);

  const meta = result.meta || {};
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};

  const out = {
    times: [], opens: [], highs: [], lows: [], closes: [], volumes: [],
  };

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
