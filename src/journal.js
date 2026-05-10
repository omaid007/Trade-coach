const KEY = "tc_journal_v1";

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch { return []; }
}
function save(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

function computeStats(list) {
  const closed = list.filter(t => t.exit != null);
  if (!closed.length) return null;
  const wins     = closed.filter(t => t.pnl > 0).length;
  const totalR   = closed.reduce((a, t) => a + (t.r ?? 0), 0);
  const totalPnl = closed.reduce((a, t) => a + (t.pnl ?? 0), 0);
  return {
    trades:  closed.length,
    winRate: (wins / closed.length) * 100,
    avgR:    totalR / closed.length,
    totalPnl,
  };
}

function f2(n)    { return n != null ? Math.abs(n).toFixed(2) : "—"; }
function sign(n)  { return n != null ? (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2) : "—"; }

function renderStats() {
  const el = document.getElementById("jnl-stats");
  if (!el) return;
  const s = computeStats(load());
  if (!s) { el.innerHTML = `<div class="jnl-no-stats">No closed trades yet.</div>`; return; }
  el.innerHTML = `
    <div class="jnl-stat"><div class="jnl-stat-lbl">Trades</div><div class="jnl-stat-val">${s.trades}</div></div>
    <div class="jnl-stat"><div class="jnl-stat-lbl">Win Rate</div><div class="jnl-stat-val ${s.winRate >= 50 ? "bull" : "bear"}">${s.winRate.toFixed(0)}%</div></div>
    <div class="jnl-stat"><div class="jnl-stat-lbl">Avg R</div><div class="jnl-stat-val ${s.avgR >= 0 ? "bull" : "bear"}">${sign(s.avgR)}R</div></div>
    <div class="jnl-stat jnl-stat-total"><div class="jnl-stat-lbl">Total P&amp;L</div><div class="jnl-stat-val ${s.totalPnl >= 0 ? "bull" : "bear"}">$${sign(s.totalPnl)}</div></div>`;
}

function renderTable() {
  const el = document.getElementById("jnl-table");
  if (!el) return;
  const list = load();
  if (!list.length) { el.innerHTML = `<div class="loading">No trades logged yet.</div>`; return; }

  const rows = list.slice().reverse().map(t => `<tr>
    <td>${t.date ?? "—"}</td>
    <td><strong>${t.symbol}</strong></td>
    <td>${t.direction === "long" ? "▲ Long" : "▼ Short"}</td>
    <td>${t.shares ?? "—"}</td>
    <td>$${f2(t.entry)}</td>
    <td>$${f2(t.stop)}</td>
    <td>${t.exit != null ? "$" + f2(t.exit) : "—"}</td>
    <td class="${(t.pnl ?? 0) >= 0 ? "bull" : "bear"}">${t.pnl != null ? "$" + sign(t.pnl) : "—"}</td>
    <td class="${(t.r ?? 0) >= 0 ? "bull" : "bear"}">${t.r != null ? sign(t.r) + "R" : "—"}</td>
    <td style="color:var(--text-dim);font-size:11px;">${t.setup ?? "—"}</td>
    <td><button class="jnl-del-btn" data-id="${t.id}">✕</button></td>
  </tr>`).join("");

  el.innerHTML = `<div class="jnl-table-wrap"><table class="jnl-tbl">
    <thead><tr>
      <th>Date</th><th>Symbol</th><th>Dir</th><th>Shares</th>
      <th>Entry</th><th>Stop</th><th>Exit</th><th>P&amp;L</th><th>R</th><th>Setup</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function addTrade(e) {
  e.preventDefault();
  const g = id => document.getElementById(id)?.value?.trim();
  const sym    = g("jnl-sym")?.toUpperCase();
  const dir    = g("jnl-dir");
  const shares = parseFloat(g("jnl-shares"));
  const entry  = parseFloat(g("jnl-entry"));
  const stop   = parseFloat(g("jnl-stop"));
  const exit   = parseFloat(g("jnl-exit")) || null;
  const setup  = g("jnl-setup") || null;
  const notes  = g("jnl-notes") || null;

  if (!sym || isNaN(entry) || isNaN(stop)) return;

  const riskPerShare = Math.abs(entry - stop);
  let pnl = null, r = null;
  if (exit != null) {
    const mult = dir === "long" ? 1 : -1;
    pnl = (exit - entry) * (shares || 0) * mult;
    r   = riskPerShare > 0 ? (exit - entry) * mult / riskPerShare : null;
  }

  const list = load();
  list.push({
    id: Date.now(),
    date: new Date().toISOString().slice(0, 10),
    symbol: sym, direction: dir, shares: shares || null,
    entry, stop, exit, pnl, r, setup, notes,
  });
  save(list);
  document.getElementById("jnl-form")?.reset();
  renderStats();
  renderTable();
}

export function initJournal() {
  document.getElementById("jnl-form")?.addEventListener("submit", addTrade);
  document.getElementById("jnl-table")?.addEventListener("click", e => {
    if (!e.target.classList.contains("jnl-del-btn")) return;
    const id = parseInt(e.target.dataset.id);
    save(load().filter(t => t.id !== id));
    renderStats();
    renderTable();
  });
  renderStats();
  renderTable();
}

export function journalUpdatePlan(plan, symbol) {
  const symEl = document.getElementById("jnl-sym");
  if (symEl) symEl.value = symbol;
  if (!plan || plan.direction === "flat") return;
  const dirEl   = document.getElementById("jnl-dir");
  const entryEl = document.getElementById("jnl-entry");
  const stopEl  = document.getElementById("jnl-stop");
  const setupEl = document.getElementById("jnl-setup");
  if (dirEl)   dirEl.value   = plan.direction;
  if (entryEl) entryEl.value = ((plan.entry.lo + plan.entry.hi) / 2).toFixed(2);
  if (stopEl)  stopEl.value  = plan.stop.toFixed(2);
  if (setupEl) setupEl.value = plan.key ?? "";
}
