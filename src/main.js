/**
 * Entry point. Holds STATE, wires DOM events, orchestrates analyze().
 *
 * Keep this thin. Business logic lives in indicators/setups/plan/api/brokers.
 * DOM logic lives in render.js. This file is the conductor.
 */

import { fetchCommentary, buildSnapshot, buildPlanSnapshot, fetchAIPlan } from "./ai.js";
import { initSettings, applyStoredTheme, getDefaults } from "./settings.js";
import { STYLE_CONFIG } from "./config.js";
import { fetchOHLC, fetchConfig, setAuthPassword, apiFetch, authHeaders } from "./api.js";
import { initTastytrade, updateTastytradeOrder, atPriceTick, atUpdateIndicators, atUpdateOptionsFlow, ttIsConnected, ttArmBracket } from "./tastytrade.js";
import { initPaperTrading, paperUpdatePlan, paperTabActivated, paperTabDeactivated } from "./paper.js";
import { initWatchlist, watchlistTabActivated, watchlistTabDeactivated } from "./watchlist.js";
import { initShortTerm, shortTermTabActivated, shortTermTabDeactivated } from "./shortterm.js";
import { initLongTerm, longTermTabActivated, longTermTabDeactivated } from "./longterm.js";
import { initJournal, journalUpdatePlan } from "./journal.js";
import { initScreener, screenerTabActivated } from "./screener.js";
import { initPortfolio, portfolioTabActivated, portfolioTabDeactivated } from "./portfolio.js";
import { initAlerts, alertsSetSymbol } from "./alerts.js";
import { runBacktest } from "./backtest.js";
import { initAutocomplete } from "./autocomplete.js";
import { getSession } from "./session.js";
import { startStream, stopStream } from "./streamer.js";
import { fetchOptionsFlow } from "./options.js";
import { fetchNews } from "./news.js";
import { computeAll } from "./indicators.js";
import { detectSetups } from "./setups.js";
import { buildPlan } from "./plan.js";
import { f2 } from "./format.js";
import {
  renderHeader,
  renderTV,
  renderIndicators,
  renderPlan,
  renderChecklist,
  renderAIPlan,
  renderAgentResult,
  renderMultiTF,
  renderOptionsChain,
  renderLevels,
  renderReport,
  renderExecution,
  renderTick,
  renderOptionsFlow,
  renderNews,
  renderCalculators,
  renderBacktest,
} from "./render.js";

/* ---------- OPTIONS REFRESH ---------- */
const OPTIONS_REFRESH_MS = { day: 30_000, swing: 60_000, position: 120_000 };
let _optionsTimer = null;

async function refreshOptions() {
  if (!STATE.symbol) return;
  try {
    const flow = await fetchOptionsFlow(STATE.symbol);
    renderOptionsFlow(flow);
    atUpdateOptionsFlow(flow);
  } catch {}
  _optionsTimer = setTimeout(refreshOptions, OPTIONS_REFRESH_MS[STATE.style]);
}

function startOptionsRefresh() {
  clearTimeout(_optionsTimer);
  refreshOptions();
}

function stopOptionsRefresh() {
  clearTimeout(_optionsTimer);
  _optionsTimer = null;
}

/* ---------- NEWS REFRESH ---------- */
const NEWS_REFRESH_MS = { day: 5 * 60_000, swing: 10 * 60_000, position: 30 * 60_000 };
let _newsTimer = null;

async function refreshNews() {
  if (!STATE.symbol) return;
  try {
    const data = await fetchNews(STATE.symbol);
    renderNews(data);
  } catch {}
  _newsTimer = setTimeout(refreshNews, NEWS_REFRESH_MS[STATE.style]);
}

function startNewsRefresh() {
  clearTimeout(_newsTimer);
  refreshNews();
}

function stopNewsRefresh() {
  clearTimeout(_newsTimer);
  _newsTimer = null;
}

/* ---------- AUTO-REFRESH ---------- */
const REFRESH_MS = { day: 5 * 60_000, swing: 15 * 60_000, position: 60 * 60_000 };
let _refreshTimer    = null;
let _countdownTimer  = null;
let _refreshAt       = null;

function cancelRefresh() {
  clearTimeout(_refreshTimer);
  clearInterval(_countdownTimer);
  _refreshTimer = _countdownTimer = _refreshAt = null;
  const badge = document.getElementById("autoRefreshBadge");
  if (badge) badge.style.display = "none";
}

function scheduleRefresh() {
  cancelRefresh();
  if (!STATE.data) return;
  const delay = REFRESH_MS[STATE.style];
  _refreshAt = Date.now() + delay;

  const badge     = document.getElementById("autoRefreshBadge");
  const countdown = document.getElementById("autoRefreshCountdown");
  if (badge) badge.style.display = "inline";

  _countdownTimer = setInterval(() => {
    if (!countdown || !_refreshAt) return;
    const secs = Math.max(0, Math.round((_refreshAt - Date.now()) / 1000));
    const m = Math.floor(secs / 60), s = secs % 60;
    countdown.textContent = `${m}:${String(s).padStart(2, "0")}`;
  }, 1000);

  _refreshTimer = setTimeout(() => {
    clearInterval(_countdownTimer);
    if (document.hidden) { scheduleRefresh(); return; } // tab not visible — skip, re-arm
    analyze();
  }, delay);
}

/* ---------- STATE ---------- */
applyStoredTheme();
const _defs = getDefaults();
const STATE = {
  symbol: _defs.symbol,
  style: _defs.style,              // "day" | "swing" | "position"
  accountSize: _defs.accountSize,
  riskPct: _defs.riskPct,
  data: null,    // OHLC bundle from api.fetchOHLC
  ind: null,     // indicators from indicators.computeAll
  setups: [],    // ranked setups from setups.detectSetups
  plan: null,    // current trade plan from plan.buildPlan
};

/* ---------- ORCHESTRATION ---------- */
async function analyze() {
  const sym = document.getElementById("tickerInput").value.trim().toUpperCase();
  if (!sym) return;
  cancelRefresh();
  stopStream();
  stopOptionsRefresh();
  stopNewsRefresh();
  STATE.symbol = sym;
  _aiCache = null;
  _aiPlanCache = null;
  document.getElementById("aiCommentary").textContent = "";
  document.getElementById("aiPlanBody")?.replaceChildren();
  document.getElementById("aiPlanStatus")?.replaceChildren();
  document.getElementById("aiPlanSection")?.style && (document.getElementById("aiPlanSection").style.display = "none");
  const cfg = STYLE_CONFIG[STATE.style];

  document.getElementById("oneLiner").innerHTML =
    `<em>Fetching ${sym} on ${STATE.style} timeframe…</em>`;
  const verdict = document.getElementById("verdict");
  verdict.textContent = "ANALYZING…";
  verdict.className = "verdict flat";

  try {
    const data = await fetchOHLC(sym, cfg.range, cfg.interval);
    if (data.closes.length < 50) {
      throw new Error("Not enough data for indicators");
    }

    STATE.data = data;
    STATE.ind = computeAll(data);
    STATE.setups = detectSetups(data, STATE.ind, STATE.style);
    STATE.plan = buildPlan(
      STATE.setups[0],
      data.closes.at(-1),
      STATE.accountSize,
      STATE.riskPct,
    );

    renderTV(sym, STATE.style);
    renderHeader(data, STATE.ind, STATE.setups[0], STATE.style);
    renderIndicators(data, STATE.ind, STATE.setups[0]);
    renderLevels(data, STATE.ind, sym);
    renderReport(data, STATE.ind, STATE.setups, STATE.plan, STATE.style);
    renderPlan(STATE.plan, STATE.style, onUpdateSizing);
    syncRiskSelectorUI();
    _agentCache = null;
    _chainCache = null;
    const mtfBtn = document.getElementById("multitf-run-btn");
    if (mtfBtn) { mtfBtn.disabled = false; mtfBtn.textContent = "Analyze All Timeframes"; }
    const chainBody = document.getElementById("chain-body");
    if (chainBody) chainBody.innerHTML = `<div class="loading">Click the "Options Chain" tab to load.</div>`;
    const agentsBtn = document.getElementById("agentsRunBtn");
    if (agentsBtn) { agentsBtn.disabled = false; agentsBtn.textContent = "Run Agent Analysis"; }
    document.getElementById("agents-result")?.style && (document.getElementById("agents-result").style.display = "none");
    document.getElementById("agents-launch")?.style && (document.getElementById("agents-launch").style.display = "");
    renderChecklist(STATE.data, STATE.ind, STATE.setups[0], STATE.plan);
    const aiPlanSec = document.getElementById("aiPlanSection");
    if (aiPlanSec) aiPlanSec.style.display = STATE.plan?.direction !== "flat" ? "" : "none";
    updateExecuteFromPlan();
    renderExecution(STATE.plan, sym, STATE.style);
    updateTastytradeOrder(STATE.plan, sym, STATE.style);
    atUpdateIndicators(STATE.ind);
    paperUpdatePlan(STATE.plan, sym);
    renderCalculators(STATE.plan);
    const btResult = runBacktest(STATE.data, STATE.ind, STATE.setups[0]);
    renderBacktest(btResult, STATE.setups[0]?.name ?? "");
    alertsSetSymbol(sym);
    journalUpdatePlan(STATE.plan, sym);
    fetchEarnings(sym);
    scheduleRefresh();
    startStream(sym, (tick) => { renderTick(tick); atPriceTick(tick); });
    startOptionsRefresh();
    startNewsRefresh();
  } catch (e) {
    if (e.code === 401) { showLogin(); return; }
    document.getElementById("oneLiner").innerHTML =
      `<span class="error">Error: ${e.message}. Check the ticker or try again.</span>`;
    scheduleRefresh(); // retry on next cycle even after error
  }
}

function onUpdateSizing(accountSize, riskPct) {
  STATE.accountSize = accountSize;
  STATE.riskPct = riskPct;
  STATE.plan = buildPlan(
    STATE.setups[0],
    STATE.data.closes.at(-1),
    accountSize,
    riskPct,
  );
  renderPlan(STATE.plan, STATE.style, onUpdateSizing);
  renderExecution(STATE.plan, STATE.symbol, STATE.style);
  renderCalculators(STATE.plan);
  updateExecuteFromPlan();
}

/* ---------- RISK SELECTOR ---------- */
const RISK_PROFILES = { conservative: 0.5, moderate: 1, aggressive: 2 };

function initRiskSelector() {
  const stored = localStorage.getItem("risk_profile") || "moderate";
  applyRiskProfile(stored, false);
  document.querySelectorAll(".risk-pill").forEach(btn => {
    btn.addEventListener("click", () => applyRiskProfile(btn.dataset.risk, true));
  });
}

function applyRiskProfile(profile, save) {
  document.querySelectorAll(".risk-pill").forEach(b => b.classList.toggle("active", b.dataset.risk === profile));
  if (profile !== "custom") {
    STATE.riskPct = RISK_PROFILES[profile] ?? STATE.riskPct;
  }
  if (save) {
    localStorage.setItem("risk_profile", profile);
    if (STATE.data && STATE.setups[0]) onUpdateSizing(STATE.accountSize, STATE.riskPct);
  }
}

function syncRiskSelectorUI() {
  const stored = localStorage.getItem("risk_profile") || "moderate";
  document.querySelectorAll(".risk-pill").forEach(b => b.classList.toggle("active", b.dataset.risk === stored));
  const row = document.getElementById("riskSelectorRow");
  if (row) row.style.display = "";
}

/* ---------- EXECUTE FROM PLAN ---------- */
function updateExecuteFromPlan() {
  const row    = document.getElementById("executeFromPlanRow");
  const status = document.getElementById("executeFromPlanStatus");
  if (!row) return;
  const hasActivePlan = STATE.plan && STATE.plan.direction !== "flat" && STATE.plan.shares > 0;
  const connected     = ttIsConnected();
  row.style.display   = hasActivePlan && connected ? "" : "none";
  if (status) status.textContent = "";
}

/* ---------- EARNINGS ---------- */
async function fetchEarnings(sym) {
  const row  = document.getElementById("earningsRow");
  const date = document.getElementById("earningsDate");
  const eps  = document.getElementById("earningsEps");
  const rev  = document.getElementById("earningsRev");
  const pe   = document.getElementById("earningsPE");
  // reset
  [row, eps, rev, pe].forEach(el => { if (el) el.style.display = "none"; });
  if (date) date.textContent = "";

  try {
    const data = await apiFetch(`/api/earnings?symbol=${encodeURIComponent(sym)}`);
    if (!data || !data.nextDate) return;

    if (row)  row.style.display  = "flex";
    if (date) { date.textContent = `📅 Next earnings: ${data.nextDate}`; }
    if (eps && data.epsEst)  { eps.textContent = `EPS est: ${data.epsEst}`;  eps.style.display = ""; }
    if (rev && data.revEst)  { rev.textContent = `Rev est: ${data.revEst}`;  rev.style.display = ""; }
    if (pe  && data.peRatio) { pe.textContent  = `P/E: ${data.peRatio}`;     pe.style.display  = ""; }
  } catch {}
}

/* ---------- AI COMMENTARY ---------- */
let _aiCache     = null; // { key, text }
let _aiPlanCache = null; // { key, text }

async function requestAI() {
  const btn = document.getElementById("aiBtn");
  const out = document.getElementById("aiCommentary");
  if (!STATE.data || !STATE.setups[0]) return;

  const cacheKey = `${STATE.symbol}:${STATE.style}`;
  if (_aiCache?.key === cacheKey) {
    out.textContent = _aiCache.text;
    return;
  }

  btn.disabled = true;
  btn.textContent = "✦ Thinking…";
  out.textContent = "";

  try {
    const snapshot = buildSnapshot(STATE.data, STATE.ind, STATE.setups[0], STATE.plan, STATE.style);
    const text = await fetchCommentary(snapshot);
    _aiCache = { key: cacheKey, text };
    out.textContent = text;
  } catch (e) {
    out.textContent = `Could not get commentary: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "✦ Ask AI";
  }
}

/* ---------- AI PLAN ---------- */
async function requestAIPlan() {
  const btn    = document.getElementById("aiPlanBtn");
  const status = document.getElementById("aiPlanStatus");

  if (!STATE.data || !STATE.setups[0] || !STATE.plan || STATE.plan.direction === "flat") return;

  const cacheKey = `${STATE.symbol}:${STATE.style}`;
  if (_aiPlanCache?.key === cacheKey) { renderAIPlan(_aiPlanCache.text); return; }

  btn.disabled    = true;
  btn.textContent = "✦ Analyzing…";
  if (status) status.textContent = "Sending to Claude…";

  try {
    const snapshot = buildPlanSnapshot(STATE.data, STATE.ind, STATE.setups[0], STATE.plan, STATE.style);
    const text     = await fetchAIPlan(snapshot);
    _aiPlanCache   = { key: cacheKey, text };
    renderAIPlan(text);
    if (status) status.textContent = "";
  } catch (e) {
    if (status) status.textContent = `Error: ${e.message}`;
    renderAIPlan("");
  } finally {
    btn.disabled    = false;
    btn.textContent = "✦ Generate AI Plan";
  }
}

/* ---------- MULTI-TIMEFRAME ---------- */
async function runMultiTF() {
  if (!STATE.symbol) return;
  const body = document.getElementById("multitf-body");
  const btn  = document.getElementById("multitf-run-btn");
  if (btn) { btn.textContent = "Analyzing…"; btn.disabled = true; }

  const STYLES = ["day", "swing", "position"];
  const results = await Promise.all(STYLES.map(async style => {
    const cfg = STYLE_CONFIG[style];
    try {
      const data  = await fetchOHLC(STATE.symbol, cfg.range, cfg.interval);
      const ind   = computeAll(data);
      const setup = detectSetups(data, ind, style)[0];
      return { style, data, ind, setup };
    } catch (e) {
      return { style, error: e.message };
    }
  }));

  renderMultiTF(results);
  if (btn) { btn.textContent = "Re-analyze"; btn.disabled = false; }
}

/* ---------- OPTIONS CHAIN ---------- */
let _chainCache = null; // { symbol, ts, data }
const CHAIN_TTL = 5 * 60_000;

async function loadOptionsChain(dateTs = null) {
  if (!STATE.symbol) return;
  const body = document.getElementById("chain-body");

  const cacheKey = `${STATE.symbol}:${dateTs ?? ""}`;
  if (_chainCache?.key === cacheKey && Date.now() - _chainCache.ts < CHAIN_TTL) {
    renderOptionsChain(_chainCache.data, STATE.data?.closes?.at(-1));
    return;
  }

  if (body) body.innerHTML = `<div class="loading">Loading options chain…</div>`;
  try {
    const url = `/api/options-chain?symbol=${encodeURIComponent(STATE.symbol)}` +
                (dateTs ? `&date=${encodeURIComponent(dateTs)}` : "");
    const data = await apiFetch(url);
    _chainCache = { key: cacheKey, ts: Date.now(), data };
    renderOptionsChain(data, STATE.data?.closes?.at(-1));
  } catch (e) {
    if (body) body.innerHTML = `<span class="error">Options chain unavailable: ${e.message}</span>`;
  }
}

/* ---------- AGENT ANALYSIS ---------- */
let _agentCache = null; // { key, data }

async function runAgentAnalysis() {
  if (!STATE.symbol) return;
  const btn    = document.getElementById("agentsRunBtn");
  const launch = document.getElementById("agents-launch");
  const result = document.getElementById("agents-result");
  if (!btn) return;

  const cacheKey = STATE.symbol;
  if (_agentCache?.key === cacheKey) {
    renderAgentResult(_agentCache.data);
    if (result) result.style.display = "";
    if (launch) launch.style.display = "none";
    return;
  }

  btn.disabled    = true;
  btn.textContent = "Running agents… (1–3 min)";
  if (result) result.style.display = "none";

  try {
    const r = await fetch("/api/agents/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ symbol: STATE.symbol }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Agent service error ${r.status}`);
    _agentCache = { key: cacheKey, data };
    renderAgentResult(data);
    if (result) result.style.display = "";
    if (launch) launch.style.display = "none";

    // If agents recommend a risk profile, apply it
    if (data.risk_profile_recommendation) {
      applyRiskProfile(data.risk_profile_recommendation, true);
    }
  } catch (e) {
    if (result) {
      result.style.display = "";
      result.innerHTML = `<span class="error">Agent analysis failed: ${e.message}</span>`;
    }
  } finally {
    btn.disabled    = false;
    btn.textContent = "Run Agent Analysis";
  }
}

/* ---------- COPY TICKET ---------- */
function copyTicket() {
  const plan = STATE.plan;
  if (!plan || plan.direction === "flat") return;

  const action = plan.direction === "long" ? "BUY" : "SELL SHORT";
  const isBreakout = plan.key === "breakout_long";
  const text = [
    `${STATE.symbol} — ${action}`,
    `Order: ${isBreakout ? "Stop Limit" : "Limit"}`,
    `Qty: ${plan.shares}`,
    isBreakout ? `Stop trigger: $${f2(plan.entry.lo)}` : null,
    `Limit: $${f2(plan.entry.hi)}`,
    `Stop loss: $${f2(plan.stop)}`,
    `Targets: $${plan.targets.map((t) => f2(t.price)).join(" / $")}`,
    `TIF: ${STATE.style === "day" ? "DAY" : "GTC"}`,
  ].filter(Boolean).join("\n");

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copyTicketBtn");
    const old = btn.textContent;
    btn.textContent = "✓ Copied";
    setTimeout(() => (btn.textContent = old), 1500);
  });
}

/* ---------- MAIN NAV ---------- */
let _activeMain = "home";

function switchMainTab(name) {
  if (name === _activeMain) return;
  if (_activeMain === "paper")      paperTabDeactivated();
  if (_activeMain === "watchlist")  watchlistTabDeactivated();
  if (_activeMain === "shortterm")  shortTermTabDeactivated();
  if (_activeMain === "longterm")   longTermTabDeactivated();
  if (_activeMain === "portfolio")  portfolioTabDeactivated();

  document.querySelectorAll(".main-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.main === name)
  );
  document.querySelectorAll(".main-panel").forEach(p => {
    p.style.display = p.id === "main-" + name ? "" : "none";
  });

  _activeMain = name;
  if (name === "paper")      paperTabActivated();
  if (name === "watchlist")  watchlistTabActivated();
  if (name === "shortterm")  shortTermTabActivated();
  if (name === "longterm")   longTermTabActivated();
  if (name === "screener")   screenerTabActivated();
  if (name === "portfolio")  portfolioTabActivated();
}

/* ---------- EVENT WIRING ---------- */
function wireEvents() {
  // Main nav
  document.querySelectorAll(".main-tab").forEach(b =>
    b.addEventListener("click", () => switchMainTab(b.dataset.main))
  );

  // Sub-tabs (home panel)
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      document.getElementById("panel-" + t.dataset.tab).classList.add("active");
    });
  });

  // Style toggle (day / swing / position)
  document.querySelectorAll(".style-toggle button").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".style-toggle button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      STATE.style = b.dataset.style;
      if (STATE.data) analyze();
    });
  });

  // Broker dropdown — re-render execution panel only
  document.getElementById("brokerSelect").addEventListener("change", () => {
    renderExecution(STATE.plan, STATE.symbol, STATE.style);
  });

  // Analyze button + Enter key
  document.getElementById("analyzeBtn").addEventListener("click", analyze);
  document.getElementById("tickerInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") analyze();
  });

  // Copy ticket
  document.getElementById("copyTicketBtn").addEventListener("click", copyTicket);

  // AI commentary
  document.getElementById("aiBtn").addEventListener("click", requestAI);

  // AI plan
  document.getElementById("aiPlanBtn").addEventListener("click", requestAIPlan);

  // Multi-TF analysis
  document.getElementById("multitf-run-btn")?.addEventListener("click", runMultiTF);

  // Options chain — load when tab activated, reload on expiry change
  document.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", () => {
      if (t.dataset.tab === "chain" && STATE.symbol) loadOptionsChain();
    });
  });
  document.getElementById("chain-body")?.addEventListener("chain-load-date", e => {
    loadOptionsChain(e.detail.ts);
  });

  // Agent analysis
  document.getElementById("agentsRunBtn")?.addEventListener("click", runAgentAnalysis);

  // Execute bracket from plan card
  document.getElementById("executeFromPlanBtn")?.addEventListener("click", () => {
    const status = document.getElementById("executeFromPlanStatus");
    if (!ttIsConnected()) {
      if (status) status.textContent = "Not connected — go to the Tastytrade tab to connect first.";
      return;
    }
    if (status) status.textContent = "";
    ttArmBracket();
  });
}

/* ---------- AUTH ---------- */
function showLogin() {
  document.getElementById("loginOverlay").style.display = "flex";
  document.getElementById("loginPassword").focus();
}

function hideLogin() {
  document.getElementById("loginOverlay").style.display = "none";
}

async function tryLogin() {
  const pw = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.style.display = "none";

  setAuthPassword(pw);
  try {
    await fetchConfig(); // verify password is accepted
    sessionStorage.setItem("tradeCoachPassword", pw);
    hideLogin();
    analyze();
  } catch (e) {
    if (e.code === 401) {
      errEl.style.display = "block";
      setAuthPassword("");
    }
  }
}

/* ---------- SESSION TICKER ---------- */
function renderSession() {
  const s = getSession();
  const el = document.getElementById("sessionPill");
  if (!el) return;
  const qualityCls = s.quality === "high" ? "bull" : s.quality === "avoid" ? "bear" : "";
  el.textContent = `${s.name} · ${s.timeET}`;
  el.className = "pill " + qualityCls;
  el.title = s.quality === "avoid"
    ? `Low-quality session. Next active: ${s.nextName} in ${s.countdown}`
    : s.remaining != null
      ? `${s.remaining}m remaining · Next: ${s.nextName} in ${s.countdown}`
      : `Next active session: ${s.nextName} in ${s.countdown}`;
}

/* ---------- BOOT ---------- */
wireEvents();

document.getElementById("loginBtn").addEventListener("click", tryLogin);
document.getElementById("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryLogin();
});

const savedPw = sessionStorage.getItem("tradeCoachPassword");
if (savedPw) setAuthPassword(savedPw);

// Apply saved defaults to DOM controls
document.getElementById("tickerInput").value = STATE.symbol;
document.querySelectorAll(".style-toggle button").forEach(b => {
  b.classList.toggle("active", b.dataset.style === STATE.style);
});

initSettings();
initRiskSelector();
initTastytrade();
initPaperTrading();

const _goAnalyze = (sym, style) => {
  document.getElementById("tickerInput").value = sym;
  if (style && style !== STATE.style) {
    STATE.style = style;
    document.querySelectorAll(".style-toggle button").forEach(b =>
      b.classList.toggle("active", b.dataset.style === style)
    );
  }
  switchMainTab("home");
  analyze();
};

initAutocomplete(document.getElementById("tickerInput"), _goAnalyze);
initWatchlist(_goAnalyze);
initShortTerm(_goAnalyze);
initLongTerm(_goAnalyze);
initJournal();
initScreener();
initPortfolio(_goAnalyze);
initAlerts();
renderSession();
setInterval(renderSession, 60_000);

fetchConfig()
  .then(({ authRequired }) => {
    if (authRequired && !savedPw) {
      showLogin();
    } else {
      analyze();
    }
  })
  .catch(() => analyze()); // server not running — try anyway, will show error
