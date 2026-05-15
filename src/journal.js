const KEY = "tc_journal_v1";

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch { return []; }
}
function save(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

// ── Formatters ────────────────────────────────────────────────────────────────
function f2(n)   { return n != null ? Math.abs(n).toFixed(2) : "—"; }
function f0(n)   { return n != null ? Math.abs(Math.round(n)).toLocaleString() : "—"; }
function sign(n) { return n != null ? (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2) : "—"; }
function pnlStr(n) {
  if (n == null) return "—";
  return (n >= 0 ? "+$" : "−$") + f0(Math.abs(n));
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function computeStats(list) {
  const closed = list.filter(t => t.exit != null);
  const open   = list.filter(t => t.exit == null);
  if (!closed.length) return { trades: 0, open: open.length };
  const wins     = closed.filter(t => (t.pnl ?? 0) > 0).length;
  const totalR   = closed.reduce((a, t) => a + (t.r   ?? 0), 0);
  const totalPnl = closed.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const pnls     = closed.map(t => t.pnl ?? 0);
  return {
    trades: closed.length, open: open.length,
    winRate: (wins / closed.length) * 100,
    avgR: totalR / closed.length,
    totalPnl,
    bestPnl:  Math.max(...pnls),
    worstPnl: Math.min(...pnls),
  };
}

function computeSetupStats(list) {
  const bySetup = {};
  list.filter(t => t.exit != null && t.setup).forEach(t => {
    (bySetup[t.setup] = bySetup[t.setup] || []).push(t);
  });
  return Object.entries(bySetup).map(([setup, trades]) => {
    const wins   = trades.filter(t => (t.pnl ?? 0) > 0).length;
    const totalR = trades.reduce((a, t) => a + (t.r ?? 0), 0);
    return { setup, trades: trades.length, winRate: (wins / trades.length) * 100, avgR: totalR / trades.length };
  }).sort((a, b) => b.trades - a.trades);
}

// ── Render: Stats bar ─────────────────────────────────────────────────────────
function renderStats() {
  const el = document.getElementById("jnl-stats");
  if (!el) return;
  const s = computeStats(load());
  if (!s.trades && !s.open) {
    el.innerHTML = `<div class="jnl-no-stats">No trades logged yet — add your first trade below.</div>`;
    return;
  }
  const cells = [
    { lbl: "Closed",  val: s.trades,                          cls: "" },
    s.open > 0 ? { lbl: "Open", val: s.open, cls: "bull" } : null,
    s.winRate != null ? { lbl: "Win Rate", val: s.winRate.toFixed(0) + "%", cls: s.winRate >= 50 ? "bull" : "bear" } : null,
    s.avgR    != null ? { lbl: "Avg R", val: (s.avgR >= 0 ? "+" : "") + s.avgR.toFixed(2) + "R", cls: s.avgR >= 0 ? "bull" : "bear" } : null,
    s.totalPnl != null ? { lbl: "Total P&L", val: pnlStr(s.totalPnl), cls: s.totalPnl >= 0 ? "bull" : "bear", big: true } : null,
    s.bestPnl  != null && s.bestPnl  >  0 ? { lbl: "Best",  val: "+$" + f0(s.bestPnl),              cls: "bull" } : null,
    s.worstPnl != null && s.worstPnl <  0 ? { lbl: "Worst", val: "−$" + f0(Math.abs(s.worstPnl)),   cls: "bear" } : null,
  ].filter(Boolean);
  el.innerHTML = cells.map(c =>
    `<div class="jnl-stat${c.big ? " jnl-stat-total" : ""}">
       <div class="jnl-stat-lbl">${c.lbl}</div>
       <div class="jnl-stat-val ${c.cls}">${c.val}</div>
     </div>`
  ).join("");
}

// ── Render: Equity curve ─────────────────────────────────────────────────────
function renderCurve() {
  const el = document.getElementById("jnl-curve");
  if (!el) return;
  const closed = load().filter(t => t.exit != null).sort((a, b) => a.id - b.id);
  if (closed.length < 2) {
    el.innerHTML = `<div style="color:var(--text-faint);font-size:12px;padding:12px 0;">Need at least 2 closed trades to plot the curve.</div>`;
    return;
  }
  let running = 0;
  const pts = [0];
  closed.forEach(t => { running += t.pnl ?? 0; pts.push(running); });

  const W = 400, H = 100, P = 4;
  const minY = Math.min(0, ...pts), maxY = Math.max(0, ...pts);
  const yRange = Math.max(maxY - minY, 1);
  const sx = i  => P + (i / (pts.length - 1)) * (W - P * 2);
  const sy = y  => P + (1 - (y - minY) / yRange) * (H - P * 2);
  const final = pts[pts.length - 1];
  const col   = final >= 0 ? "var(--green)" : "var(--red)";
  const zeroY = sy(0);
  const poly  = pts.map((y, i) => `${sx(i).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");
  const fill  = poly + ` ${sx(pts.length - 1).toFixed(1)},${zeroY.toFixed(1)} ${sx(0).toFixed(1)},${zeroY.toFixed(1)}`;

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:90px;display:block;">
      <defs>
        <linearGradient id="jnlg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${col}" stop-opacity=".25"/>
          <stop offset="100%" stop-color="${col}" stop-opacity=".02"/>
        </linearGradient>
      </defs>
      <line x1="${P}" y1="${zeroY.toFixed(1)}" x2="${W - P}" y2="${zeroY.toFixed(1)}"
            stroke="var(--border)" stroke-width=".6" stroke-dasharray="3,3"/>
      <polygon points="${fill}" fill="url(#jnlg)"/>
      <polyline points="${poly}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="${sx(pts.length - 1).toFixed(1)}" cy="${sy(final).toFixed(1)}" r="3" fill="${col}"/>
      <text x="${(W - P - 2).toFixed(1)}" y="${Math.max(12, sy(final) - 5).toFixed(1)}"
            text-anchor="end" fill="${col}" font-size="10" font-weight="700">
        ${final >= 0 ? "+" : ""}$${Math.round(Math.abs(final)).toLocaleString()}
      </text>
    </svg>`;
}

// ── Render: Per-setup breakdown ───────────────────────────────────────────────
function renderSetupStats() {
  const el = document.getElementById("jnl-setup-stats");
  if (!el) return;
  const stats = computeSetupStats(load());
  if (!stats.length) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);margin-bottom:6px;">By Setup</div>
    ${stats.map(s => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:12px;">
        <span style="flex:1;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.setup}</span>
        <span style="color:var(--text-dim);white-space:nowrap;">${s.trades}t</span>
        <span class="${s.winRate >= 50 ? "bull" : "bear"}" style="min-width:44px;text-align:right;">${s.winRate.toFixed(0)}% WR</span>
        <span class="${s.avgR >= 0 ? "bull" : "bear"}" style="min-width:40px;text-align:right;">${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(1)}R</span>
      </div>`).join("")}`;
}

// ── Render: Trade table ───────────────────────────────────────────────────────
let _filterSym    = "";
let _filterStatus = "";
let _expandedId   = null;

function renderTable() {
  const el = document.getElementById("jnl-table");
  if (!el) return;
  let list = load().slice().reverse();

  if (_filterSym)    list = list.filter(t => t.symbol.includes(_filterSym.toUpperCase()));
  if (_filterStatus === "open")   list = list.filter(t => t.exit == null);
  if (_filterStatus === "closed") list = list.filter(t => t.exit != null);

  if (!list.length) {
    el.innerHTML = `<div class="loading">No trades match the filter.</div>`;
    return;
  }

  const rows = list.map(t => {
    const isOpen   = t.exit == null;
    const pnlCls   = (t.pnl ?? 0) >= 0 ? "bull" : "bear";
    const rCls     = (t.r   ?? 0) >= 0 ? "bull" : "bear";
    const expanded = _expandedId === t.id;

    const expandContent = `
      <tr class="jnl-expand-row">
        <td colspan="11" style="padding:0 10px 10px;">
          <div class="jnl-expand-body">
            ${t.notes ? `<div class="jnl-note-text">${t.notes}</div>` : ""}
            ${isOpen ? `
              <div class="jnl-close-form">
                <span style="font-size:11px;color:var(--text-dim);">Close at:</span>
                <input id="jnl-ce-${t.id}" type="number" step="0.01" placeholder="Exit price" style="width:110px;font-size:12px;"/>
                <input id="jnl-cn-${t.id}" type="text" placeholder="Add a note (optional)" style="flex:1;min-width:140px;font-size:12px;"/>
                <button class="jnl-close-confirm primary" data-id="${t.id}" style="font-size:11px;padding:4px 12px;">Close Trade</button>
                <button class="jnl-collapse-btn" data-id="${t.id}" style="font-size:11px;padding:4px 8px;">Cancel</button>
              </div>` : ""}
            ${!t.notes && !isOpen ? `<span style="font-size:12px;color:var(--text-faint);">No notes for this trade.</span>` : ""}
          </div>
        </td>
      </tr>`;

    return `
      <tr class="jnl-row${expanded ? " jnl-row-active" : ""}" data-id="${t.id}">
        <td style="font-size:11px;color:var(--text-dim);">${t.date ?? "—"}</td>
        <td><strong>${t.symbol}</strong></td>
        <td class="${t.direction === "long" ? "bull" : "bear"}" style="font-size:11px;font-weight:600;">${t.direction === "long" ? "▲ Long" : "▼ Short"}</td>
        <td style="color:var(--text-dim);">${t.shares ?? "—"}</td>
        <td>$${f2(t.entry)}</td>
        <td style="color:var(--red);">$${f2(t.stop)}</td>
        <td>${isOpen ? `<span class="pill bull" style="font-size:10px;padding:2px 7px;">Open</span>` : `$${f2(t.exit)}`}</td>
        <td class="${pnlCls}" style="font-weight:600;">${pnlStr(t.pnl)}</td>
        <td class="${rCls}">${t.r != null ? sign(t.r) + "R" : "—"}</td>
        <td style="color:var(--text-faint);font-size:11px;max-width:90px;overflow:hidden;text-overflow:ellipsis;">${t.setup ?? "—"}</td>
        <td>
          ${t.notes || isOpen ? `<button class="jnl-expand-btn" data-id="${t.id}" title="${expanded ? "Collapse" : isOpen ? "Close trade" : "View notes"}" style="font-size:11px;color:var(--text-dim);padding:2px 6px;border-radius:4px;">${expanded ? "▲" : isOpen ? "Close" : "Notes"}</button>` : ""}
          <button class="jnl-del-btn" data-id="${t.id}" title="Delete">✕</button>
        </td>
      </tr>
      ${expanded ? expandContent : ""}`;
  }).join("");

  el.innerHTML = `
    <div class="jnl-table-wrap">
      <table class="jnl-tbl">
        <thead><tr>
          <th>Date</th><th>Symbol</th><th>Dir</th><th>Qty</th>
          <th>Entry</th><th>Stop</th><th>Exit</th>
          <th>P&amp;L</th><th>R</th><th>Setup</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Mutations ─────────────────────────────────────────────────────────────────
function addTrade(e) {
  e.preventDefault();
  const g = id => document.getElementById(id)?.value?.trim() ?? "";
  const sym    = g("jnl-sym").toUpperCase();
  const dir    = g("jnl-dir");
  const shares = parseFloat(g("jnl-shares")) || null;
  const entry  = parseFloat(g("jnl-entry"));
  const stop   = parseFloat(g("jnl-stop"));
  const exit   = parseFloat(g("jnl-exit"))  || null;
  const setup  = g("jnl-setup")  || null;
  const notes  = g("jnl-notes")  || null;
  const date   = g("jnl-date")   || new Date().toISOString().slice(0, 10);

  if (!sym || isNaN(entry) || isNaN(stop)) return;

  const riskPerShare = Math.abs(entry - stop);
  let pnl = null, r = null;
  if (exit != null && shares) {
    const mult = dir === "long" ? 1 : -1;
    pnl = (exit - entry) * shares * mult;
    r   = riskPerShare > 0 ? (exit - entry) * mult / riskPerShare : null;
  }

  const list = load();
  list.push({ id: Date.now(), date, symbol: sym, direction: dir, shares, entry, stop, exit, pnl, r, setup, notes });
  save(list);
  document.getElementById("jnl-form")?.reset();
  const dateEl = document.getElementById("jnl-date");
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
  refresh();
}

function closeTrade(id, exitPrice, extraNote) {
  const list = load();
  const t = list.find(t => t.id === id);
  if (!t || t.exit != null) return;
  const mult = t.direction === "long" ? 1 : -1;
  const riskPerShare = Math.abs(t.entry - t.stop);
  t.exit = exitPrice;
  t.pnl  = (exitPrice - t.entry) * (t.shares || 0) * mult;
  t.r    = riskPerShare > 0 ? (exitPrice - t.entry) * mult / riskPerShare : null;
  if (extraNote) t.notes = [t.notes, extraNote].filter(Boolean).join(" · ");
  save(list);
  _expandedId = null;
  refresh();
}

function deleteTrade(id) {
  save(load().filter(t => t.id !== id));
  if (_expandedId === id) _expandedId = null;
  refresh();
}

function exportCsv() {
  const list = load();
  if (!list.length) return;
  const headers = ["Date", "Symbol", "Direction", "Shares", "Entry", "Stop", "Exit", "P&L", "R", "Setup", "Notes"];
  const rows    = list.map(t => [
    t.date ?? "",
    t.symbol,
    t.direction,
    t.shares ?? "",
    t.entry,
    t.stop,
    t.exit ?? "",
    t.pnl?.toFixed(2) ?? "",
    t.r?.toFixed(3)   ?? "",
    t.setup ?? "",
    `"${(t.notes ?? "").replace(/"/g, '""')}"`,
  ].join(","));
  const csv  = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `trade-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function refresh() {
  renderStats();
  renderCurve();
  renderSetupStats();
  renderTable();
}

// ── Public exports ────────────────────────────────────────────────────────────
export function initJournal() {
  document.getElementById("jnl-form")?.addEventListener("submit", addTrade);

  const dateEl = document.getElementById("jnl-date");
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

  // Table event delegation
  document.getElementById("jnl-table")?.addEventListener("click", e => {
    if (e.target.classList.contains("jnl-del-btn")) {
      const id = parseInt(e.target.dataset.id);
      if (confirm("Delete this trade?")) deleteTrade(id);
      return;
    }
    if (e.target.classList.contains("jnl-close-confirm")) {
      const id      = parseInt(e.target.dataset.id);
      const exitEl  = document.getElementById(`jnl-ce-${id}`);
      const noteEl  = document.getElementById(`jnl-cn-${id}`);
      const exit    = parseFloat(exitEl?.value);
      if (isNaN(exit) || exit <= 0) { exitEl?.focus(); return; }
      closeTrade(id, exit, noteEl?.value?.trim() || null);
      return;
    }
    if (e.target.classList.contains("jnl-collapse-btn")) {
      _expandedId = null;
      renderTable();
      return;
    }
    if (e.target.classList.contains("jnl-expand-btn")) {
      const id = parseInt(e.target.dataset.id);
      _expandedId = _expandedId === id ? null : id;
      renderTable();
      return;
    }
  });

  document.getElementById("jnl-filter-sym")?.addEventListener("input", e => {
    _filterSym = e.target.value.trim();
    renderTable();
  });
  document.getElementById("jnl-filter-status")?.addEventListener("change", e => {
    _filterStatus = e.target.value;
    renderTable();
  });
  document.getElementById("jnl-export-btn")?.addEventListener("click", exportCsv);

  refresh();
}

export function journalUpdatePlan(plan, symbol) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set("jnl-sym", symbol ?? "");
  if (!plan || plan.direction === "flat") return;
  set("jnl-dir",    plan.direction);
  set("jnl-entry",  ((plan.entry.lo + plan.entry.hi) / 2).toFixed(2));
  set("jnl-stop",   plan.stop.toFixed(2));
  set("jnl-setup",  plan.key ?? "");
  set("jnl-shares", plan.shares ?? "");
}
