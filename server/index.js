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

// ─── Yahoo Finance OHLC ───────────────────────────────────────────────────────

app.get("/api/quote", requireAuth, async (req, res) => {
  const { symbol, range, interval } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const path =
    `/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval || "1d"}&range=${range || "6mo"}&includePrePost=false`;

  // Reuse crumb cookie if fresh; otherwise fetch a fresh one.
  // Cloud IPs (Railway, etc.) are blocked unless the request includes a valid YF session cookie.
  let cookie = (_yfCookie && Date.now() < _yfCrumbExpiry) ? _yfCookie : null;
  if (!cookie) {
    try {
      const r = await fetch("https://finance.yahoo.com", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      cookie = (r.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).join("; ") || null;
      if (cookie) { _yfCookie = cookie; _yfCrumbExpiry = Date.now() + 55 * 60_000; }
    } catch {}
  }

  const hdrs = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
  };
  if (cookie) hdrs["Cookie"] = cookie;

  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com${path}`, { headers: hdrs });
      if (!r.ok) continue;
      return res.json(await r.json());
    } catch {}
  }

  res.status(502).json({ error: "Yahoo Finance is temporarily unavailable from this server. Please try again in a moment." });
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
  const fields = "shortName,regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,averageVolume,marketCap,fiftyTwoWeekHigh,fiftyTwoWeekLow";
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=${fields}`;
  try {
    const r = await fetch(url, { headers: yfHdrs() });
    const data = await r.json();
    const quotes = (data.quoteResponse?.result ?? []).map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePct: q.regularMarketChangePercent,
      volume: q.regularMarketVolume,
      avgVolume: q.averageVolume,
      high52: q.fiftyTwoWeekHigh,
      low52: q.fiftyTwoWeekLow,
      marketCap: q.marketCap,
    }));
    res.json({ quotes });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── Market screener ──────────────────────────────────────────────────────────

app.get("/api/screener", requireAuth, async (req, res) => {
  const { screen = "gainers" } = req.query;

  if (screen === "trending") {
    try {
      const r1 = await fetch("https://query1.finance.yahoo.com/v1/finance/trending/US?count=20", { headers: yfHdrs() });
      const d1 = await r1.json();
      const syms = (d1.finance?.result?.[0]?.quotes ?? []).map(q => q.symbol).join(",");
      if (!syms) return res.json({ quotes: [] });
      const r2 = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms)}`, { headers: yfHdrs() });
      const d2 = await r2.json();
      const quotes = (d2.quoteResponse?.result ?? []).map(q => ({
        symbol: q.symbol, name: q.shortName || q.symbol,
        price: q.regularMarketPrice, change: q.regularMarketChange,
        changePct: q.regularMarketChangePercent, volume: q.regularMarketVolume, marketCap: q.marketCap,
      }));
      return res.json({ quotes });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  const scrIds = { gainers: "day_gainers", losers: "day_losers", active: "most_actives" };
  const scrId = scrIds[screen] || "day_gainers";
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=${scrId}&count=20&region=US&lang=en-US`;
  try {
    const r = await fetch(url, { headers: yfHdrs() });
    const data = await r.json();
    const quotes = (data.finance?.result?.[0]?.quotes ?? []).map(q => ({
      symbol: q.symbol, name: q.shortName || q.longName || q.symbol,
      price: q.regularMarketPrice, change: q.regularMarketChange,
      changePct: q.regularMarketChangePercent, volume: q.regularMarketVolume, marketCap: q.marketCap,
    }));
    res.json({ quotes });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
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
