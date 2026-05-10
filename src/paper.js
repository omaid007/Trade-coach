/**
 * Paper trading — virtual positions, history, and portfolio stats.
 * State is persisted in localStorage so it survives page refresh.
 * Prices are refreshed from /api/quote every 60 s while the tab is active.
 */

import { f0, f2 } from "./format.js";

// ─── Data helpers ─────────────────────────────────────────────────────────────

const KEY = "tc_paper_v1";

function blank(starting = 25_000) {
  return { starting, positions: [], history: [] };
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || blank(); }
  catch { return blank(); }
}

function save() { localStorage.setItem(KEY, JSON.stringify(_s)); }

function stats() {
  const realized   = _s.history.reduce((a, h) => a + h.pnl, 0);
  const unrealized = _s.positions.reduce((a, p) => {
    const m = p.direction === "long" ? 1 : -1;
    return a + (p.markPrice - p.entryPrice) * p.shares * m;
  }, 0);
  const longCost  = _s.positions
    .filter(p => p.direction === "long")
    .reduce((a, p) => a + p.shares * p.entryPrice, 0);
  const cash      = _s.starting + realized - longCost;
  const portfolio = _s.starting + realized + unrealized;
  return { cash, realized, unrealized, portfolio, totalPnL: portfolio - _s.starting };
}

// ─── Module state ─────────────────────────────────────────────────────────────

let _s           = load();
let _refreshTimer = null;
let _planCtx     = null;   // { plan, symbol }

// ─── Price refresh ────────────────────────────────────────────────────────────

async function refreshPrices() {
  const symbols = [...new Set(_s.positions.map(p => p.symbol))];
  for (const sym of symbols) {
    try {
      const r    = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}&range=1d&interval=1d`);
      const json = await r.json();
      const px   = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (px) _s.positions.forEach(p => { if (p.symbol === sym) p.markPrice = px; });
    } catch {}
  }
  renderPositions();
  renderStats();
  _refreshTimer = setTimeout(refreshPrices, 60_000);
}

function stopRefresh() {
  clearTimeout(_refreshTimer);
  _refreshTimer = null;
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

const el = id => document.getElementById(id);

// ─── Render: portfolio stats ──────────────────────────────────────────────────

function renderStats() {
  const { cash, unrealized, realized, portfolio, totalPnL } = stats();
  const sgn = v => v >= 0 ? "pos" : "neg";
  const fmt = v => `${v >= 0 ? "+" : "–"}$${f0(Math.abs(v))}`;

  const pEl = el("pp-portfolio"); if (pEl) pEl.textContent = `$${f0(portfolio)}`;
  const cEl = el("pp-cash");      if (cEl) cEl.textContent = `$${f0(cash)}`;

  const uEl = el("pp-unreal");
  if (uEl) { uEl.textContent = fmt(unrealized); uEl.className = `pp-stat-val ${sgn(unrealized)}`; }

  const rEl = el("pp-realized");
  if (rEl) { rEl.textContent = fmt(realized); rEl.className = `pp-stat-val ${sgn(realized)}`; }

  const tEl = el("pp-total-pnl");
  if (tEl) {
    const pct = ((totalPnL / _s.starting) * 100).toFixed(1);
    tEl.innerHTML = `<span class="${sgn(totalPnL)}">${fmt(totalPnL)} (${pct}%)</span>`;
  }
}

// ─── Render: open positions ───────────────────────────────────────────────────

function renderPositions() {
  const container = el("pp-positions");
  if (!container) return;

  if (!_s.positions.length) {
    container.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:8px 0;">No open positions.</div>`;
    return;
  }

  const header = `
    <div class="pp-row pp-row-hdr">
      <span>Symbol</span><span>Dir</span><span>Shares</span>
      <span>Entry</span><span>Mark</span><span>P&amp;L</span><span>R</span><span></span>
    </div>`;

  const rows = _s.positions.map(p => {
    const m     = p.direction === "long" ? 1 : -1;
    const pnl   = (p.markPrice - p.entryPrice) * p.shares * m;
    const pct   = ((p.markPrice - p.entryPrice) / p.entryPrice) * 100 * m;
    const sd    = p.stopLoss ? Math.abs(p.entryPrice - p.stopLoss) : 0;
    const r     = sd > 0 ? (Math.abs(p.markPrice - p.entryPrice) / sd * Math.sign(pnl)).toFixed(1) + "R" : "—";
    const cls   = pnl >= 0 ? "pos" : "neg";
    return `
      <div class="pp-row">
        <span class="pp-sym">${p.symbol}</span>
        <span class="${p.direction === "long" ? "pos" : "neg"}">${p.direction === "long" ? "▲ Long" : "▼ Short"}</span>
        <span>${p.shares.toLocaleString()}</span>
        <span>$${f2(p.entryPrice)}</span>
        <span>$${f2(p.markPrice)}</span>
        <span class="${cls}">${pnl >= 0 ? "+" : "–"}$${f0(Math.abs(pnl))}<br><small>${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</small></span>
        <span style="color:var(--text-dim)">${r}</span>
        <span><button class="copy-btn pp-close-btn" data-id="${p.id}">Close</button></span>
      </div>`;
  }).join("");

  container.innerHTML = header + rows;
  container.querySelectorAll(".pp-close-btn").forEach(btn =>
    btn.addEventListener("click", () => promptClose(+btn.dataset.id))
  );
}

// ─── Render: trade history ────────────────────────────────────────────────────

function renderHistory() {
  const container = el("pp-history");
  if (!container) return;

  if (!_s.history.length) {
    container.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:8px 0;">No completed trades yet.</div>`;
    return;
  }

  const fmtDate = ts => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const header = `
    <div class="pp-hist-row pp-hist-hdr">
      <span>Date</span><span>Symbol</span><span>Dir</span>
      <span>Shares</span><span>Entry</span><span>Exit</span><span>P&amp;L</span><span>R</span>
    </div>`;

  const rows = _s.history.slice(0, 100).map(h => {
    const cls  = h.pnl >= 0 ? "pos" : "neg";
    const sign = h.pnl >= 0 ? "+" : "–";
    return `
      <div class="pp-hist-row">
        <span style="color:var(--text-faint)">${fmtDate(h.closedAt)}</span>
        <span class="pp-sym">${h.symbol}</span>
        <span class="${h.direction === "long" ? "pos" : "neg"}">${h.direction === "long" ? "▲" : "▼"}</span>
        <span>${h.shares.toLocaleString()}</span>
        <span>$${f2(h.entryPrice)}</span>
        <span>$${f2(h.exitPrice)}</span>
        <span class="${cls}">${sign}$${f0(Math.abs(h.pnl))}<br><small>${h.pct >= 0 ? "+" : ""}${h.pct.toFixed(1)}%</small></span>
        <span style="color:var(--text-dim)">${h.rMult != null ? h.rMult.toFixed(1) + "R" : "—"}</span>
      </div>`;
  }).join("");

  container.innerHTML = header + rows;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

function openTrade() {
  const sym    = el("pp-sym")?.value?.trim()?.toUpperCase();
  const dir    = el("pp-dir")?.value ?? "long";
  const shares = parseInt(el("pp-shares")?.value) || 0;
  const entry  = parseFloat(el("pp-entry")?.value) || 0;
  const stop   = parseFloat(el("pp-stop")?.value)  || 0;
  const t1     = parseFloat(el("pp-t1")?.value)    || 0;
  const t2     = parseFloat(el("pp-t2")?.value)    || 0;

  const errEl = el("pp-form-err");
  if (!sym || !shares || !entry) {
    errEl.textContent = "Symbol, shares, and entry price are required.";
    errEl.style.display = "block";
    return;
  }

  const { cash } = stats();
  if (dir === "long" && shares * entry > cash) {
    errEl.textContent = `Insufficient cash — need $${f0(shares * entry)}, have $${f0(cash)}.`;
    errEl.style.display = "block";
    return;
  }

  errEl.style.display = "none";
  _s.positions.push({
    id:         Date.now(),
    symbol:     sym,
    direction:  dir,
    shares,
    entryPrice: entry,
    stopLoss:   stop  || null,
    targets:    [t1, t2].filter(Boolean),
    markPrice:  entry,
    openedAt:   Date.now(),
  });
  save();
  renderPositions();
  renderStats();

  // Refresh price shortly after opening
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(refreshPrices, 3_000);
}

function promptClose(posId) {
  const pos = _s.positions.find(p => p.id === posId);
  if (!pos) return;

  const exitStr = prompt(
    `Close ${pos.symbol} (${pos.direction})\nMark price: $${f2(pos.markPrice)}\n\nEnter exit price:`,
    f2(pos.markPrice)
  );
  if (exitStr === null) return;
  const exitPrice = parseFloat(exitStr);
  if (!(exitPrice > 0)) return;

  const m     = pos.direction === "long" ? 1 : -1;
  const pnl   = (exitPrice - pos.entryPrice) * pos.shares * m;
  const pct   = pnl / (pos.shares * pos.entryPrice) * 100;
  const sd    = pos.stopLoss ? Math.abs(pos.entryPrice - pos.stopLoss) : 0;
  const rMult = sd > 0 ? Math.abs(exitPrice - pos.entryPrice) / sd * Math.sign(pnl) : null;

  _s.history.unshift({
    id: Date.now(), symbol: pos.symbol, direction: pos.direction,
    shares: pos.shares, entryPrice: pos.entryPrice, exitPrice,
    openedAt: pos.openedAt, closedAt: Date.now(),
    pnl, pct, rMult,
  });
  _s.positions.splice(_s.positions.findIndex(p => p.id === posId), 1);
  save();
  renderPositions();
  renderHistory();
  renderStats();
}

// ─── Fill from plan ───────────────────────────────────────────────────────────

function fillFromPlan() {
  const ctx = _planCtx;
  if (!ctx?.plan || ctx.plan.direction === "flat") return;
  const p = ctx.plan;
  if (el("pp-sym"))    el("pp-sym").value    = ctx.symbol ?? "";
  if (el("pp-dir"))    el("pp-dir").value    = p.direction;
  if (el("pp-shares")) el("pp-shares").value = p.shares;
  if (el("pp-entry"))  el("pp-entry").value  = f2(p.entry.hi);
  if (el("pp-stop"))   el("pp-stop").value   = f2(p.stop);
  if (el("pp-t1") && p.targets[0]) el("pp-t1").value = f2(p.targets[0].price);
  if (el("pp-t2") && p.targets[1]) el("pp-t2").value = f2(p.targets[1].price);
  el("pp-form-err").style.display = "none";
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initPaperTrading() {
  // Wire static events (these elements are always in the DOM)
  el("pp-open-btn")?.addEventListener("click", openTrade);
  el("pp-fill-plan")?.addEventListener("click", fillFromPlan);

  el("pp-set-balance")?.addEventListener("click", () => {
    const val = parseFloat(el("pp-starting-input")?.value);
    if (!(val > 0)) return;
    if (_s.positions.length && !confirm("This will close all positions and reset history. Continue?")) return;
    _s = blank(val);
    save();
    renderStats();
    renderPositions();
    renderHistory();
  });

  el("pp-reset-all")?.addEventListener("click", () => {
    if (!confirm("Reset all paper trading data? This cannot be undone.")) return;
    _s = blank(_s.starting);
    save();
    renderStats();
    renderPositions();
    renderHistory();
  });

  // Set starting balance display
  const startEl = el("pp-starting-input");
  if (startEl) startEl.value = _s.starting;

  renderStats();
  renderPositions();
  renderHistory();
}

export function paperUpdatePlan(plan, symbol) {
  _planCtx = { plan, symbol };
}

export function paperTabActivated() {
  renderStats();
  renderPositions();
  renderHistory();
  if (_s.positions.length && !_refreshTimer) {
    refreshPrices();
  }
}

export function paperTabDeactivated() {
  stopRefresh();
}
