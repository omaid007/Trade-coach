import { createServer } from "http";
import express from "express";
import { WebSocketServer, WebSocket as WS } from "ws";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: process.env.DOTENV_PATH || join(__dirname, ".env") });

const PORT = process.env.PORT || 3001;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "";

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-auth-password");
  next();
});

function requireAuth(req, res, next) {
  if (!AUTH_PASSWORD) return next();
  if (req.headers["x-auth-password"] !== AUTH_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }
  next();
}

app.get("/api/config", (req, res) => {
  res.json({ authRequired: !!AUTH_PASSWORD });
});

// Diagnostic
app.get("/api/yftest", async (req, res) => {
  const results = [];

  // Yahoo Finance
  try {
    const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=5d", {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" },
    });
    results.push({ source: "yahoo", status: r.status, ok: r.ok });
  } catch (e) {
    results.push({ source: "yahoo", error: e.message });
  }

  // Twelve Data
  const tdKey = process.env.TWELVEDATA_KEY;
  results.push({ source: "twelvedata_key_set", value: !!tdKey });
  if (tdKey) {
    try {
      const r = await fetch(`https://api.twelvedata.com/time_series?symbol=AAPL&interval=1day&outputsize=3&apikey=${tdKey}`);
      const d = await r.json();
      results.push({ source: "twelvedata", ok: d.status === "ok", status: d.status, rows: d.values?.length });
    } catch (e) {
      results.push({ source: "twelvedata", error: e.message });
    }
  }

  res.json(results);
});

// ─── Twelve Data fallback (free tier: 800 req/day with free API key) ─────────

// Yahoo Finance uses BTC-USD; Twelve Data uses BTC/USD. Convert crypto pairs.
function yfToTdSymbol(symbol) {
  // Match crypto: 2-10 uppercase chars, dash, 3-5 uppercase chars (USD, USDT, EUR, BTC…)
  if (/^[A-Z0-9]{2,10}-[A-Z]{3,5}$/.test(symbol)) return symbol.replace("-", "/");
  return symbol;
}

const TD_INTERVAL_MAP = {
  "1m": "1min", "2m": "2min", "5m": "5min", "15m": "15min",
  "30m": "30min", "60m": "1h", "90m": "90min",
  "1d": "1day", "5d": "1day", "1mo": "1day", "3mo": "1day",
  "6mo": "1day", "1y": "1day", "2y": "1day", "5y": "1day", "max": "1day",
};

const TD_OUTPUTSIZE_MAP = {
  "1d": 5, "5d": 10, "1mo": 30, "3mo": 90, "6mo": 180,
  "1y": 365, "2y": 730, "5y": 1260, "max": 5000,
};

function tdOutputsizeIntraday(yfInterval, yfRange) {
  const barsPerDay = { "1m": 390, "2m": 195, "5m": 78, "15m": 26, "30m": 13, "60m": 6, "90m": 4 };
  const rangeDays  = { "1d": 1, "5d": 5, "1mo": 22, "3mo": 65, "6mo": 130, "1y": 252 };
  const bpd  = barsPerDay[yfInterval] || 78;
  const days = rangeDays[yfRange] || 5;
  return Math.min(Math.ceil(bpd * days * 1.1), 5000);
}

async function fetchFromTwelveData(symbol, range, interval, apiKey) {
  if (!apiKey) return null;
  const tdInterval = TD_INTERVAL_MAP[interval] || "1day";
  const isIntraday = !tdInterval.includes("day");
  const outputsize = isIntraday
    ? tdOutputsizeIntraday(interval, range)
    : (TD_OUTPUTSIZE_MAP[range] || 180);

  const tdSym = yfToTdSymbol(symbol);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSym)}&interval=${tdInterval}&outputsize=${outputsize}&apikey=${apiKey}`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) return null;

  const data = await r.json();
  if (data.status !== "ok" || !Array.isArray(data.values) || !data.values.length) return null;

  // Twelve Data returns newest-first — reverse for chronological order
  const rows = [...data.values].reverse().map(v => ({
    ts:     Math.floor(new Date(v.datetime).getTime() / 1000),
    open:   +v.open, high: +v.high, low: +v.low, close: +v.close,
    volume: parseInt(v.volume) || 0,
  })).filter(d => d.ts && !isNaN(d.close));

  if (!rows.length) return null;

  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const meta = data.meta || {};
  return {
    chart: { result: [{
      meta: {
        symbol:              symbol.toUpperCase(),
        longName:            meta.exchange || symbol.toUpperCase(),
        regularMarketPrice:  last.close,
        chartPreviousClose:  prev?.close ?? last.close,
        currency:            meta.currency || "USD",
        exchangeName:        meta.exchange || "",
      },
      timestamp:  rows.map(d => d.ts),
      indicators: { quote: [{ open: rows.map(d => d.open), high: rows.map(d => d.high), low: rows.map(d => d.low), close: rows.map(d => d.close), volume: rows.map(d => d.volume) }] },
    }] },
  };
}

// ─── Yahoo Finance OHLC ───────────────────────────────────────────────────────

app.get("/api/quote", requireAuth, async (req, res) => {
  const { symbol, range, interval } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const base = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval || "1d"}&range=${range || "6mo"}&includePrePost=false`;

  // 1. Try Yahoo Finance (preferred — real-time, intraday)
  try {
    const { crumb, cookie } = await getCrumb();
    const hdrs = { ...yfHdrs(), Cookie: cookie };
    const urlWithCrumb = (host) =>
      `https://${host}.finance.yahoo.com${base}&crumb=${encodeURIComponent(crumb)}`;

    for (const host of ["query1", "query2"]) {
      try {
        const r = await fetch(urlWithCrumb(host), { headers: hdrs });
        if (r.status === 401 || r.status === 403) {
          await refreshCrumb();
          const r2 = await fetch(urlWithCrumb(host), { headers: { ...yfHdrs(), Cookie: _yfCookie } });
          if (!r2.ok) continue;
          return res.json(await r2.json());
        }
        if (!r.ok) continue;
        return res.json(await r.json());
      } catch {}
    }
  } catch {}

  // 2. Twelve Data fallback (free API key, works from cloud IPs)
  const tdKey = process.env.TWELVEDATA_KEY;
  try {
    const tdData = await fetchFromTwelveData(symbol, range || "6mo", interval || "1d", tdKey);
    if (tdData) return res.json(tdData);
  } catch {}

  // No key set — tell client to try browser-direct fetch
  if (!tdKey) {
    res.status(503).json({
      error: "Stock data unavailable. Add TWELVEDATA_KEY to your Railway environment variables (free at twelvedata.com).",
      code: "NO_DATA_SOURCE",
    });
  } else {
    res.status(429).json({ error: "All data sources failed — try again shortly." });
  }
});

// ─── Yahoo Finance crumb manager ─────────────────────────────────────────────

let _yfCrumb = null, _yfCookie = null, _yfCrumbExpiry = 0;

async function refreshCrumb() {
  const UA = TT_HEADERS["User-Agent"];
  const r1 = await fetch("https://finance.yahoo.com", { headers: { "User-Agent": UA, "Accept": "text/html" } });
  const cookies = (r1.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).join("; ");
  const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, "Cookie": cookies },
  });
  const crumb = (await r2.text()).trim();
  if (!crumb || crumb === "Invalid Crumb" || crumb.length > 20) throw new Error("crumb fetch failed");
  _yfCrumb = crumb;
  _yfCookie = cookies;
  _yfCrumbExpiry = Date.now() + 55 * 60 * 1000; // cache 55 min
}

async function getCrumb() {
  if (_yfCrumb && Date.now() < _yfCrumbExpiry) return { crumb: _yfCrumb, cookie: _yfCookie };
  await refreshCrumb();
  return { crumb: _yfCrumb, cookie: _yfCookie };
}

// Returns browser-like headers for any Yahoo Finance API call.
// Includes the cached session cookie when available so cloud IPs aren't blocked.
function yfHdrs(extra = {}) {
  const h = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
    ...extra,
  };
  const cookie = (_yfCookie && Date.now() < _yfCrumbExpiry) ? _yfCookie : null;
  if (cookie) h["Cookie"] = cookie;
  return h;
}

// ─── News feed proxy ─────────────────────────────────────────────────────────

app.get("/api/news", requireAuth, async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const UA = TT_HEADERS["User-Agent"];
  const cookie = (_yfCookie && Date.now() < _yfCrumbExpiry) ? _yfCookie : null;
  const hdr = { "User-Agent": UA, "Accept": "application/json", "Referer": "https://finance.yahoo.com/" };
  if (cookie) hdr["Cookie"] = cookie;

  try {
    const [r1, r2] = await Promise.all([
      fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=12&quotesCount=1&enableFuzzyQuery=false`, { headers: hdr }),
      fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=stock+market+economy+fed&newsCount=6&quotesCount=0`, { headers: hdr }),
    ]);
    const [j1, j2] = await Promise.all([r1.json(), r2.json()]);

    // Extract upcoming events from the quote object
    const q = j1.quotes?.[0] ?? {};
    const events = {
      earningsDate:   q.earningsTimestampStart ? new Date(q.earningsTimestampStart * 1000).toISOString().slice(0, 10) : null,
      dividendDate:   q.dividendDate           ? new Date(q.dividendDate * 1000).toISOString().slice(0, 10)           : null,
      exDividendDate: q.exDividendDate?.fmt     ?? null,
    };

    const clean = (a, tag) => ({
      uuid:        a.uuid,
      title:       a.title,
      publisher:   a.publisher,
      link:        a.link,
      publishedAt: a.providerPublishTime,
      tickers:     a.relatedTickers ?? [],
      tag,
    });

    const seen = new Set();
    const articles = [
      ...(j1.news ?? []).map(a => clean(a, symbol)),
      ...(j2.news ?? []).map(a => clean(a, "MARKET")),
    ].filter(a => { if (seen.has(a.uuid)) return false; seen.add(a.uuid); return true; })
     .sort((a, b) => b.publishedAt - a.publishedAt)
     .slice(0, 20);

    res.json({ articles, events });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── Options chain proxy ──────────────────────────────────────────────────────

app.get("/api/options", requireAuth, async (req, res) => {
  const { symbol, date } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  try {
    let { crumb, cookie } = await getCrumb();
    const build = (c) => {
      let url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(c)}`;
      if (date) url += `&date=${date}`;
      return url;
    };
    const UA = TT_HEADERS["User-Agent"];
    let r = await fetch(build(crumb), { headers: { "User-Agent": UA, "Cookie": cookie, "Accept": "application/json" } });
    // If crumb expired, refresh once and retry
    if (r.status === 401 || r.status === 403) {
      await refreshCrumb();
      ({ crumb, cookie } = { crumb: _yfCrumb, cookie: _yfCookie });
      r = await fetch(build(crumb), { headers: { "User-Agent": UA, "Cookie": cookie, "Accept": "application/json" } });
    }
    if (!r.ok) throw new Error(`Yahoo options HTTP ${r.status}`);
    res.json(await r.json());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── AI Commentary ───────────────────────────────────────────────────────────

app.post("/api/ai-commentary", express.json(), requireAuth, async (req, res) => {
  const { snapshot, apiKey: bodyKey } = req.body || {};
  // Always require the key from the client — the server's env key is never exposed.
  if (!bodyKey) return res.status(403).json({ error: "Add your Anthropic API key in Settings to use AI commentary." });
  if (!snapshot) return res.status(400).json({ error: "Missing snapshot" });

  const userMsg = [
    `${snapshot.symbol} — ${snapshot.style} trade · $${snapshot.price} (${snapshot.changePct})`,
    `Setup: ${snapshot.setupName} · ${snapshot.confidence}% confidence · ${snapshot.direction?.toUpperCase()}`,
    `Trend: ${snapshot.trend} · RSI ${snapshot.rsi} · MACD: ${snapshot.macd}`,
    `Entry $${snapshot.entryLo}–$${snapshot.entryHi} · Stop $${snapshot.stop} · T1 $${snapshot.t1} (${snapshot.rr}R)`,
    snapshot.atr ? `ATR $${snapshot.atr}` : null,
  ].filter(Boolean).join("\n");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": bodyKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        system: "You are a concise trading coach. Given a technical setup, write exactly 2 short sentences: first assess whether the setup is worth trading right now, then state the one key thing to watch before entering. Be specific to the numbers. No disclaimers.",
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || `Anthropic HTTP ${r.status}` });
    }
    const data = await r.json();
    res.json({ text: data.content?.[0]?.text ?? "" });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── AI Trade Plan ───────────────────────────────────────────────────────────

app.post("/api/ai-plan", express.json(), requireAuth, async (req, res) => {
  const { snapshot: s, apiKey } = req.body || {};
  if (!apiKey) return res.status(403).json({ error: "Add your Anthropic API key in Settings to use AI plan generation." });
  if (!s)      return res.status(400).json({ error: "Missing snapshot" });

  const msg = [
    `${s.symbol} — ${s.style} trade | Price: $${s.price} (${s.changePct})`,
    ``,
    `SETUP: ${s.setupName} · ${s.direction?.toUpperCase()} · ${s.confidence}% confidence`,
    `Thesis: ${s.thesis}`,
    ``,
    `PLAN LEVELS:`,
    `  Entry zone:  $${s.entryLo} – $${s.entryHi}`,
    `  Stop loss:   $${s.stop}  (risk $${s.stopDist}/share)`,
    `  Target 1:    $${s.t1} (${s.rr1}R, +$${s.profitT1} potential on ${s.shares} shares)`,
    `  Target 2:    $${s.t2} (${s.rr2}R, +$${s.profitT2} potential)`,
    `  Position:    ${s.shares} shares · $${s.dollarRisk} at risk`,
    ``,
    `TECHNICAL DATA:`,
    `  RSI(14):     ${s.rsi} — ${s.rsiState}`,
    `  MACD:        ${s.macd} (histogram: ${s.macdHist})`,
    `  ATR(14):     $${s.atr} (${s.atrPct}% of price)`,
    `  Volume:      ${s.volRatio}x average`,
    `  vs SMA20:    ${s.vsSma20}`,
    `  vs SMA50:    ${s.vsSma50}`,
    `  vs SMA200:   ${s.vsSma200}`,
    `  BB position: ${s.bbPosition}`,
    `  Trend:       ${s.trend}`,
  ].join("\n");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 750,
        system: `You are an expert technical trader with 20 years of swing and day trading experience. Analyze the given setup and write a specific, actionable trade plan.

Rules:
- Always reference actual dollar prices — never say "entry zone" without the number
- Be concrete and direct — no vague advice
- No disclaimers whatsoever
- Assume the reader is an experienced retail trader

Output exactly these 7 labeled sections:
**ENTRY** — [2-3 sentences: why enter here and exactly what price action confirms it]
**STOP** — [1-2 sentences: why this exact stop level, what technical structure it protects]
**TARGETS** — [1-2 sentences: what T1 and T2 represent as technical levels or extensions]
**MANAGEMENT** — [2-3 sentences: when to take partial profits, when to trail, max hold time for this style]
**BULL CASE** — [1-2 sentences: conditions that would drive price significantly beyond T2]
**BEAR CASE** — [1-2 sentences: early warning signs of setup failure before stop is hit]
**VERDICT** — [1 sentence only: trade it / stand aside, and at what conviction level]`,
        messages: [{ role: "user", content: msg }],
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || `Anthropic HTTP ${r.status}` });
    }
    const data = await r.json();
    res.json({ text: data.content?.[0]?.text ?? "" });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── Tastytrade API proxy ─────────────────────────────────────────────────────

const TT = "https://api.tastytrade.com";
app.use("/api/tastytrade", express.json());

const TT_HEADERS = {
  "Accept": "application/json",
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

async function ttJson(r) {
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    if (r.status === 401) throw new Error("Invalid credentials or session expired");
    throw new Error(`Tastytrade API error (HTTP ${r.status})`);
  }
}

// Allow preflight
app.options("/api/tastytrade/*path", (req, res) => {
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE");
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-tt-session");
  res.sendStatus(204);
});

app.post("/api/tastytrade/session", async (req, res) => {
  const { username, password, challengeToken, otp } = req.body || {};
  try {
    const reqHeaders = { ...TT_HEADERS };
    if (challengeToken) reqHeaders["X-Tastyworks-Challenge-Token"] = challengeToken;
    if (otp) reqHeaders["X-Tastyworks-OTP"] = otp;

    const r = await fetch(`${TT}/sessions`, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({ login: username, password, "remember-me": false }),
    });

    const respChallengeToken = r.headers.get("x-tastyworks-challenge-token");
    const data = await ttJson(r);

    if (!r.ok) {
      if (respChallengeToken) {
        // Device challenge initiated — Tastytrade emailed the user a code
        return res.json({ challengeRequired: true, challengeToken: respChallengeToken });
      }
      return res.status(401).json({ error: data?.error?.message || "Login failed" });
    }

    res.json({ sessionToken: data.data["session-token"] });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.delete("/api/tastytrade/session", async (req, res) => {
  await fetch(`${TT}/sessions`, {
    method: "DELETE",
    headers: { Authorization: req.headers["x-tt-session"] || "" },
  }).catch(() => {});
  res.json({ ok: true });
});

app.get("/api/tastytrade/accounts", async (req, res) => {
  try {
    const r = await fetch(`${TT}/customers/me/accounts`, {
      headers: { ...TT_HEADERS, Authorization: req.headers["x-tt-session"] || "" },
    });
    const data = await ttJson(r);
    if (!r.ok) return res.status(r.status).json({ error: "Failed to fetch accounts" });
    const accounts = (data.data?.items || []).map(i => ({
      accountNumber: i.account["account-number"],
      accountType: i.account["account-type-name"],
      nickname: i.account.nickname || "",
    }));
    res.json(accounts);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/tastytrade/accounts/:acn/balances", async (req, res) => {
  try {
    const r = await fetch(`${TT}/accounts/${req.params.acn}/balances`, {
      headers: { ...TT_HEADERS, Authorization: req.headers["x-tt-session"] || "" },
    });
    const data = await ttJson(r);
    if (!r.ok) return res.status(r.status).json({ error: "Failed to fetch balances" });
    const d = data.data;
    res.json({
      netLiq: d["net-liquidating-value"],
      cashBalance: d["cash-balance"],
      buyingPower: d["equity-buying-power"],
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/tastytrade/accounts/:acn/orders/dry-run", async (req, res) => {
  try {
    const r = await fetch(`${TT}/accounts/${req.params.acn}/orders/dry-run`, {
      method: "POST",
      headers: { ...TT_HEADERS, Authorization: req.headers["x-tt-session"] || "" },
      body: JSON.stringify(req.body),
    });
    const data = await ttJson(r);
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || "Dry-run failed" });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/tastytrade/accounts/:acn/orders", async (req, res) => {
  try {
    const r = await fetch(`${TT}/accounts/${req.params.acn}/orders`, {
      method: "POST",
      headers: { ...TT_HEADERS, Authorization: req.headers["x-tt-session"] || "" },
      body: JSON.stringify(req.body),
    });
    const data = await ttJson(r);
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || "Order failed" });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/tastytrade/accounts/:acn/orders/live", async (req, res) => {
  try {
    const r = await fetch(`${TT}/accounts/${req.params.acn}/orders/live`, {
      headers: { ...TT_HEADERS, Authorization: req.headers["x-tt-session"] || "" },
    });
    const data = await ttJson(r);
    if (!r.ok) return res.status(r.status).json({ error: "Failed to fetch live orders" });
    res.json(data);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

app.get("/api/tastytrade/accounts/:acn/orders/:orderId", async (req, res) => {
  try {
    const r = await fetch(`${TT}/accounts/${req.params.acn}/orders/${req.params.orderId}`, {
      headers: { ...TT_HEADERS, Authorization: req.headers["x-tt-session"] || "" },
    });
    const data = await ttJson(r);
    if (!r.ok) return res.status(r.status).json({ error: "Failed to fetch order" });
    res.json(data);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

app.delete("/api/tastytrade/accounts/:acn/orders/:orderId", async (req, res) => {
  try {
    const r = await fetch(`${TT}/accounts/${req.params.acn}/orders/${req.params.orderId}`, {
      method: "DELETE",
      headers: { ...TT_HEADERS, Authorization: req.headers["x-tt-session"] || "" },
    });
    const data = await ttJson(r);
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || "Cancel failed" });
    res.json(data);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

app.get("/api/tastytrade/accounts/:acn/positions", async (req, res) => {
  try {
    const r = await fetch(`${TT}/accounts/${req.params.acn}/positions`, {
      headers: { ...TT_HEADERS, Authorization: req.headers["x-tt-session"] || "" },
    });
    const data = await ttJson(r);
    if (!r.ok) return res.status(r.status).json({ error: "Failed to fetch positions" });
    res.json(data);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ─── Symbol search (autocomplete) ────────────────────────────────────────────

app.get("/api/search", requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 1) return res.json({ quotes: [] });
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=7&newsCount=0&enableFuzzyQuery=true&enableNavLinks=false`;
  try {
    const r = await fetch(url, { headers: yfHdrs() });
    if (!r.ok) return res.json({ quotes: [] });
    const data = await r.json();
    const quotes = (data.quotes ?? [])
      .filter(item => ["EQUITY", "ETF", "CRYPTOCURRENCY", "INDEX", "FUTURE"].includes(item.quoteType))
      .slice(0, 6)
      .map(item => ({ symbol: item.symbol, name: item.shortname || item.longname || "", type: item.quoteType }));
    res.json({ quotes });
  } catch {
    res.json({ quotes: [] });
  }
});

// ─── Batch quotes (portfolio + screener) ─────────────────────────────────────

app.get("/api/quotes", requireAuth, async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "symbols required" });

  // 1. Try Yahoo Finance
  const fields = "shortName,regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,averageVolume,marketCap,fiftyTwoWeekHigh,fiftyTwoWeekLow";
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=${fields}`, { headers: yfHdrs() });
    if (r.ok) {
      const data = await r.json();
      const quotes = (data.quoteResponse?.result ?? []).map(q => ({
        symbol: q.symbol, name: q.shortName || q.longName || q.symbol,
        price: q.regularMarketPrice, change: q.regularMarketChange,
        changePct: q.regularMarketChangePercent, volume: q.regularMarketVolume,
        avgVolume: q.averageVolume, high52: q.fiftyTwoWeekHigh, low52: q.fiftyTwoWeekLow, marketCap: q.marketCap,
      }));
      return res.json({ quotes });
    }
  } catch {}

  // 2. Twelve Data fallback
  const tdKey = process.env.TWELVEDATA_KEY;
  if (tdKey) {
    try {
      const tdSymbols = symbols.split(",").map(yfToTdSymbol).join(",");
      const r = await fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(tdSymbols)}&apikey=${tdKey}`);
      if (r.ok) {
        const data = await r.json();
        // Single symbol returns flat object; multiple symbols returns object keyed by symbol
        const entries = data.symbol ? [data] : Object.values(data);
        const quotes = entries
          .filter(q => q.status !== "error" && q.close)
          .map(q => ({
            symbol: q.symbol, name: q.name || q.symbol,
            price: +q.close, change: +q.change,
            changePct: parseFloat(q.percent_change),
            volume: +q.volume, marketCap: null,
          }));
        return res.json({ quotes });
      }
    } catch {}
  }

  res.status(502).json({ error: "Unable to fetch quotes" });
});

// ─── Market screener ──────────────────────────────────────────────────────────

// Universe for synthetic screener when Yahoo Finance is unavailable
const SCREENER_UNIVERSE = [
  "AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","NFLX","AMD",
  "AVGO","CRM","ORCL","INTC","QCOM","GS","BAC","XOM","LLY","COST",
  "V","MA","WMT","UNH","PG","KO","ABBV","MRK","JNJ","HD",
];

// 10-minute server-side cache for synthetic screener
let _scrCache = null, _scrCacheTs = 0;

async function syntheticScreener(screen, tdKey) {
  const now = Date.now();
  if (!_scrCache || now - _scrCacheTs > 10 * 60 * 1000) {
    const syms = SCREENER_UNIVERSE.join(",");
    const r = await fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(syms)}&apikey=${tdKey}`);
    if (!r.ok) return null;
    const data = await r.json();
    const entries = Object.values(data).filter(q => q && !q.code && q.close);
    _scrCache = entries.map(q => ({
      symbol: q.symbol, name: q.name || q.symbol,
      price: +q.close, change: +q.change,
      changePct: parseFloat(q.percent_change),
      volume: +q.volume || 0, marketCap: null,
    }));
    _scrCacheTs = now;
  }
  if (screen === "active") return [..._scrCache].sort((a, b) => b.volume - a.volume).slice(0, 10);
  if (screen === "losers") return [..._scrCache].sort((a, b) => a.changePct - b.changePct).slice(0, 10);
  return [..._scrCache].sort((a, b) => b.changePct - a.changePct).slice(0, 10); // gainers + trending
}

app.get("/api/screener", requireAuth, async (req, res) => {
  const { screen = "gainers" } = req.query;
  const tdKey = process.env.TWELVEDATA_KEY;

  // 1. Try Yahoo Finance
  if (screen !== "trending") {
    const scrIds = { gainers: "day_gainers", losers: "day_losers", active: "most_actives" };
    try {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=${scrIds[screen] || "day_gainers"}&count=20&region=US&lang=en-US`,
        { headers: yfHdrs() }
      );
      if (r.ok) {
        const data = await r.json();
        const quotes = (data.finance?.result?.[0]?.quotes ?? []).map(q => ({
          symbol: q.symbol, name: q.shortName || q.longName || q.symbol,
          price: q.regularMarketPrice, change: q.regularMarketChange,
          changePct: q.regularMarketChangePercent, volume: q.regularMarketVolume, marketCap: q.marketCap,
        }));
        if (quotes.length) return res.json({ quotes });
      }
    } catch {}
  } else {
    try {
      const r1 = await fetch("https://query1.finance.yahoo.com/v1/finance/trending/US?count=20", { headers: yfHdrs() });
      if (r1.ok) {
        const d1 = await r1.json();
        const syms = (d1.finance?.result?.[0]?.quotes ?? []).map(q => q.symbol).join(",");
        if (syms) {
          const r2 = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms)}`, { headers: yfHdrs() });
          if (r2.ok) {
            const d2 = await r2.json();
            const quotes = (d2.quoteResponse?.result ?? []).map(q => ({
              symbol: q.symbol, name: q.shortName || q.symbol,
              price: q.regularMarketPrice, change: q.regularMarketChange,
              changePct: q.regularMarketChangePercent, volume: q.regularMarketVolume, marketCap: q.marketCap,
            }));
            if (quotes.length) return res.json({ quotes });
          }
        }
      }
    } catch {}
  }

  // 2. Twelve Data synthetic screener (batch quote → sort by change/volume)
  if (tdKey) {
    try {
      const quotes = await syntheticScreener(screen, tdKey);
      if (quotes?.length) return res.json({ quotes });
    } catch {}
  }

  res.json({ quotes: [] });
});

// ─── Earnings calendar ────────────────────────────────────────────────────────

app.get("/api/earnings", requireAuth, async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents,earningsTrend,defaultKeyStatistics`;
  try {
    const r = await fetch(url, { headers: yfHdrs() });
    const data = await r.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return res.json({});

    const cal = result.calendarEvents || {};
    const trend = result.earningsTrend?.trend?.[0] || {};
    const stats = result.defaultKeyStatistics || {};

    const earningsDates = (cal.earnings?.earningsDate ?? []).map(d => d.fmt).filter(Boolean);
    res.json({
      nextDate:  earningsDates[0] || null,
      epsEst:    trend.earningsEstimate?.avg?.fmt ?? null,
      revEst:    trend.revenueEstimate?.avg?.fmt ?? null,
      epsActual: stats.trailingEps?.fmt ?? null,
      peRatio:   stats.trailingPE?.fmt ?? null,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── Fundamentals (Long Term tab) ────────────────────────────────────────────

async function fetchFundamentalsFromTwelveData(symbol, apiKey) {
  if (!apiKey) return null;
  const tdSym = yfToTdSymbol(symbol);
  const [sR, qR] = await Promise.all([
    fetch(`https://api.twelvedata.com/statistics?symbol=${encodeURIComponent(tdSym)}&apikey=${apiKey}`),
    fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(tdSym)}&apikey=${apiKey}`),
  ]);
  const [stats, quote] = await Promise.all([sR.ok ? sR.json() : {}, qR.ok ? qR.json() : {}]);
  if (stats.code || quote.code) return null; // TD error response

  const vao = stats?.statistics?.valuations_and_outlook || {};
  const inc = stats?.statistics?.financials?.income_statement || {};
  const bal = stats?.statistics?.financials?.balance_sheet || {};
  const cf  = stats?.statistics?.financials?.cash_flow || {};
  const sk  = stats?.statistics?.stock_statistics || {};
  const div = stats?.statistics?.dividends_and_splits || {};

  const tdv = (obj, key) => {
    const x = obj[key];
    if (x == null) return null;
    const n = typeof x === "object" ? (x.value ?? null) : x;
    return n == null || n === "" ? null : +n;
  };
  const tdstr = (obj, key) => {
    const x = obj[key];
    if (x == null) return null;
    return typeof x === "object" ? (x.value ?? null) : String(x);
  };

  const price     = quote.close     ? +quote.close     : null;
  const prevClose = quote.previous_close ? +quote.previous_close : null;

  return {
    name:        quote.name  || stats.name  || symbol,
    exchange:    quote.exchange || stats.exchange || "",
    currency:    quote.currency || stats.currency || "USD",
    price,
    change:      price && prevClose ? price - prevClose : null,
    changePct:   price && prevClose ? (price - prevClose) / prevClose : null,
    marketCap:   tdv(vao, "market_capitalization"),
    pe:          tdv(vao, "trailing_pe"),
    forwardPE:   tdv(vao, "forward_pe"),
    eps:         tdv(inc, "diluted_eps_ttm"),
    forwardEps:  null,
    priceToBook: tdv(vao, "price_to_book_mrq"),
    ev:          tdv(vao, "enterprise_value"),
    revenueGrowth:   tdv(inc, "quarterly_revenue_growth_yoy"),
    earningsGrowth:  tdv(inc, "quarterly_earnings_growth_yoy"),
    profitMargin:    null,
    operatingMargin: null,
    grossMargin:     null,
    roe: null, roa: null,
    totalRevenue:  tdv(inc, "revenue_ttm"),
    freeCashflow:  tdv(cf,  "free_cash_flow_ttm"),
    debtToEquity:  tdv(bal, "total_debt_to_equity_mrq"),
    currentRatio:  tdv(bal, "current_ratio_mrq"),
    dividendYield: tdv(div, "trailing_annual_dividend_yield"),
    dividendRate:  tdv(div, "trailing_annual_dividend_rate"),
    payoutRatio:   tdv(div, "payout_ratio"),
    exDivDate:     tdstr(div, "ex_dividend_date"),
    beta:   tdv(sk, "beta_5y"),
    low52:  tdv(sk, "52_week_low"),
    high52: tdv(sk, "52_week_high"),
    targetMean: null, targetHigh: null, targetLow: null,
    recKey: null, analystCount: null,
    recStrongBuy: null, recBuy: null, recHold: null, recSell: null, recStrongSell: null,
    nextEarnings: null, epsEst: null, revEst: null,
  };
}

app.get("/api/fundamentals", requireAuth, async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  // 1. Try Yahoo Finance
  const modules = "summaryDetail,defaultKeyStatistics,financialData,calendarEvents,earningsTrend,price,recommendationTrend";
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`,
      { headers: yfHdrs() }
    );
    if (r.ok) {
      const data = await r.json();
      const result = data?.quoteSummary?.result?.[0];
      if (result) {
        const sd  = result.summaryDetail || {};
        const ks  = result.defaultKeyStatistics || {};
        const fd  = result.financialData || {};
        const cal = result.calendarEvents || {};
        const trend = result.earningsTrend?.trend?.[0] || {};
        const p   = result.price || {};
        const rec = result.recommendationTrend?.trend?.[0] || {};
        const earningsDates = (cal.earnings?.earningsDate ?? []).map(d => d.fmt).filter(Boolean);
        return res.json({
          name: p.longName || p.shortName || symbol,
          exchange: p.exchangeName || "",
          currency: p.currency || "USD",
          price: p.regularMarketPrice?.raw,
          change: p.regularMarketChange?.raw,
          changePct: p.regularMarketChangePercent?.raw,
          marketCap: p.marketCap?.raw,
          pe: sd.trailingPE?.raw, forwardPE: sd.forwardPE?.raw,
          eps: ks.trailingEps?.raw, forwardEps: ks.forwardEps?.raw,
          priceToBook: ks.priceToBook?.raw, ev: ks.enterpriseValue?.raw,
          revenueGrowth: fd.revenueGrowth?.raw, earningsGrowth: fd.earningsGrowth?.raw,
          profitMargin: fd.profitMargins?.raw, operatingMargin: fd.operatingMargins?.raw,
          grossMargin: fd.grossMargins?.raw, roe: fd.returnOnEquity?.raw, roa: fd.returnOnAssets?.raw,
          totalRevenue: fd.totalRevenue?.raw, freeCashflow: fd.freeCashflow?.raw,
          debtToEquity: fd.debtToEquity?.raw, currentRatio: fd.currentRatio?.raw,
          dividendYield: sd.dividendYield?.raw, dividendRate: sd.dividendRate?.raw,
          payoutRatio: sd.payoutRatio?.raw, exDivDate: sd.exDividendDate?.fmt,
          beta: sd.beta?.raw, low52: sd.fiftyTwoWeekLow?.raw, high52: sd.fiftyTwoWeekHigh?.raw,
          targetMean: fd.targetMeanPrice?.raw, targetHigh: fd.targetHighPrice?.raw,
          targetLow: fd.targetLowPrice?.raw, recKey: fd.recommendationKey,
          analystCount: fd.numberOfAnalystOpinions?.raw,
          recStrongBuy: rec.strongBuy, recBuy: rec.buy, recHold: rec.hold,
          recSell: rec.sell, recStrongSell: rec.strongSell,
          nextEarnings: earningsDates[0] || null,
          epsEst: trend.earningsEstimate?.avg?.fmt, revEst: trend.revenueEstimate?.avg?.fmt,
        });
      }
    }
  } catch {}

  // 2. Twelve Data fallback
  const tdKey = process.env.TWELVEDATA_KEY;
  try {
    const tdData = await fetchFundamentalsFromTwelveData(symbol, tdKey);
    if (tdData) return res.json(tdData);
  } catch {}

  res.status(502).json({ error: "Unable to fetch fundamentals — market data unavailable." });
});

// ─── Agent service proxy ─────────────────────────────────────────────────────

const AGENTS_URL    = process.env.AGENTS_URL    || "";
const AGENTS_SECRET = process.env.AGENTS_SECRET || "";

app.post("/api/agents/analyze", express.json(), requireAuth, async (req, res) => {
  if (!AGENTS_URL) {
    return res.status(503).json({ error: "Agent service not configured — add AGENTS_URL to Railway env vars." });
  }
  const { symbol, date } = req.body || {};
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  try {
    const r = await fetch(`${AGENTS_URL}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(AGENTS_SECRET ? { "x-agents-secret": AGENTS_SECRET } : {}),
      },
      body: JSON.stringify({ symbol, date: date || null }),
      signal: AbortSignal.timeout(250_000),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || data.error || `Agent service error ${r.status}`);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Serve production build
app.use(express.static(join(__dirname, "../dist")));

// ─── HTTP + WebSocket server ──────────────────────────────────────────────────

const httpServer = createServer(app);

// ─── Yahoo Finance WebSocket proxy ───────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

const YF_WS = "wss://streamer.finance.yahoo.com";
const YF_HEADERS = {
  "Origin": "https://finance.yahoo.com",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

wss.on("connection", (client) => {
  let yfWs = null;
  let symbols = [];

  const connect = () => {
    if (yfWs) yfWs.terminate();
    yfWs = new WS(YF_WS, { headers: YF_HEADERS });

    yfWs.on("open", () => {
      yfWs.send(JSON.stringify({ subscribe: symbols }));
    });

    yfWs.on("message", (data) => {
      if (client.readyState === WS.OPEN) client.send(data.toString());
    });

    yfWs.on("error", () => {});

    yfWs.on("close", () => {
      if (client.readyState === WS.OPEN && symbols.length) {
        setTimeout(connect, 4000);
      }
    });
  };

  client.on("message", (msg) => {
    try {
      const { subscribe } = JSON.parse(msg.toString());
      if (Array.isArray(subscribe) && subscribe.length) {
        symbols = subscribe;
        connect();
      }
    } catch {}
  });

  client.on("close", () => {
    symbols = [];
    if (yfWs) yfWs.terminate();
  });
});

export function startServer(port = 0) {
  return new Promise((resolve, reject) => {
    httpServer
      .listen(port, "0.0.0.0", () => {
        const bound = httpServer.address().port;
        console.log(`Trade Coach server → http://127.0.0.1:${bound}`);
        resolve(bound);
      })
      .on("error", reject);
  });
}

// Auto-start when invoked directly (npm run server)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer(parseInt(process.env.PORT) || PORT);
}
