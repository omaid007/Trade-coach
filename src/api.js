let _password = "";

export function setAuthPassword(p) { _password = p; }
export function authHeaders() { return _password ? { "x-auth-password": _password } : {}; }

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

export async function fetchOHLC(symbol, range, interval) {
  // 1. Server-side proxy (Yahoo Finance → Twelve Data fallback)
  try {
    const params = new URLSearchParams({ symbol, range, interval });
    const res = await fetch(`/api/quote?${params}`, {
      cache: "no-store",
      headers: _password ? { "x-auth-password": _password } : {},
    });
    if (res.status === 401) { const e = new Error("Auth required"); e.code = 401; throw e; }
    if (res.status === 503) {
      // Server explicitly told us it has no data source configured
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Stock data unavailable — no data source configured on server.");
    }
    if (res.ok) {
      const data = await res.json();
      return parseYfChart(data, symbol);
    }
    // Non-fatal server error (429 etc.) — fall through to browser fallback
  } catch (e) {
    if (e.code === 401) throw e;
    // Re-throw the 503 "setup required" error immediately
    if (e.message.includes("TWELVEDATA_KEY") || e.message.includes("no data source")) throw e;
  }

  // 2. Direct browser fetch to Yahoo Finance (works when user's browser IP isn't rate-limited)
  const yfPath =
    `/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}&includePrePost=false`;
  for (const host of ["query1", "query2"]) {
    try {
      const res = await fetch(`https://${host}.finance.yahoo.com${yfPath}`, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      return parseYfChart(data, symbol);
    } catch {}
  }

  // 3. Stooq browser fetch (EOD only, CORS-friendly when available)
  if (!/^[0-9]+(m|h)$/.test(interval || "")) {
    try {
      return await _fetchStooq(symbol, range);
    } catch {}
  }

  throw new Error("Unable to fetch data — try again shortly.");
}

// ─── Stooq browser-side fetch ─────────────────────────────────────────────────

function _stooqSym(sym) {
  const up = sym.toUpperCase();
  const idx = { "^GSPC": "^SPX", "^VIX": "^VIX", "^DJI": "^DJI", "^IXIC": "^NDQ", "^RUT": "^RUT", "^TNX": "^TNX" };
  if (idx[up]) return idx[up];
  if (up.startsWith("^")) return up;
  return up + ".US";
}

async function _fetchStooq(symbol, range) {
  const days = { "1d": 5, "5d": 10, "1mo": 35, "3mo": 95, "6mo": 185, "1y": 370, "2y": 730, "5y": 1825, "max": 7300 }[range] || 185;
  const to   = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const fmt  = d => d.toISOString().slice(0, 10).replace(/-/g, "");

  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(_stooqSym(symbol))}&d1=${fmt(from)}&d2=${fmt(to)}&i=d`;
  const res  = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);

  const csv = await res.text();
  if (!csv || csv.startsWith("No data") || !csv.includes(",")) throw new Error("No Stooq data");

  const lines = csv.trim().split("\n");
  if (lines.length < 2) throw new Error("Stooq: no rows");

  // Stooq returns newest-first — reverse for chronological order
  const rows = lines.slice(1).reverse().map(line => {
    const [date, open, high, low, close, volume] = line.split(",");
    return {
      ts:     new Date(date).getTime(),
      open:   +open, high: +high, low: +low, close: +close,
      volume: parseInt(volume) || 0,
    };
  }).filter(d => d.ts && !isNaN(d.close));

  if (!rows.length) throw new Error("Stooq: empty dataset");

  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  return {
    times:   rows.map(d => d.ts),
    opens:   rows.map(d => d.open),
    highs:   rows.map(d => d.high),
    lows:    rows.map(d => d.low),
    closes:  rows.map(d => d.close),
    volumes: rows.map(d => d.volume),
    meta: {
      symbol:    symbol.toUpperCase(),
      name:      symbol.toUpperCase(),
      price:     last.close,
      prevClose: prev?.close ?? last.close,
      currency:  "USD",
      exchange:  "Stooq",
    },
  };
}

// ─── Yahoo Finance chart parser ───────────────────────────────────────────────

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
