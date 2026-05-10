import { apiFetch } from "./api.js";

const KEY = "tc_portfolio_v1";
let _positions = [];
let _prices = {};
let _refreshTimer = null;
let _onAnalyze = null;

export function initPortfolio(onAnalyze) {
  _onAnalyze = onAnalyze;
  _positions = load();
  wireEvents();
  render();
}

export function portfolioTabActivated() {
  refresh();
  _refreshTimer = setInterval(refresh, 60_000);
}

export function portfolioTabDeactivated() {
  clearInterval(_refreshTimer);
  _refreshTimer = null;
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(_positions));
}

function wireEvents() {
  document.getElementById("pf-add-btn").addEventListener("click", addPosition);
  document.getElementById("pf-sym").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addPosition();
  });

  document.getElementById("pf-list").addEventListener("click", (e) => {
    const del = e.target.closest("[data-pf-del]");
    if (del) {
      const sym = del.dataset.pfDel;
      _positions = _positions.filter(p => p.symbol !== sym);
      delete _prices[sym];
      save();
      render();
      return;
    }
    const analyze = e.target.closest("[data-pf-analyze]");
    if (analyze) _onAnalyze(analyze.dataset.pfAnalyze);
  });
}

function addPosition() {
  const sym = document.getElementById("pf-sym").value.trim().toUpperCase();
  const shares = parseFloat(document.getElementById("pf-shares").value);
  const cost = parseFloat(document.getElementById("pf-cost").value);
  if (!sym || isNaN(shares) || shares <= 0 || isNaN(cost) || cost <= 0) return;

  const existing = _positions.find(p => p.symbol === sym);
  if (existing) {
    const total = existing.shares + shares;
    existing.cost = (existing.shares * existing.cost + shares * cost) / total;
    existing.shares = total;
  } else {
    _positions.push({ symbol: sym, shares, cost, added: Date.now() });
  }
  save();
  document.getElementById("pf-sym").value = "";
  document.getElementById("pf-shares").value = "";
  document.getElementById("pf-cost").value = "";
  render();
  refresh();
}

async function refresh() {
  if (!_positions.length) return;
  const symbols = _positions.map(p => p.symbol).join(",");
  try {
    const { quotes = [] } = await apiFetch(`/api/quotes?symbols=${encodeURIComponent(symbols)}`);
    quotes.forEach(q => { _prices[q.symbol] = q; });
    render();
  } catch {}
}

const fmt$ = (n, dec = 0) => n != null
  ? `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`
  : "—";
const fmtPct = (n) => n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "—";
const fmtSign$ = (n) => n != null ? `${n >= 0 ? "+" : "-"}${fmt$(n, 0)}` : "—";
const cls = (n) => n == null ? "" : n >= 0 ? "pos" : "neg";

export function render() {
  const list = document.getElementById("pf-list");
  const sumEl = document.getElementById("pf-summary");

  if (!_positions.length) {
    list.innerHTML = `<div class="pf-empty">No positions yet — add one above.</div>`;
    sumEl.innerHTML = "";
    return;
  }

  let totalValue = 0, totalCost = 0, totalDay = 0;

  const rows = _positions.map(p => {
    const q = _prices[p.symbol];
    const price = q?.price ?? null;
    const mktVal = price != null ? price * p.shares : null;
    const costBasis = p.cost * p.shares;
    const pnl = mktVal != null ? mktVal - costBasis : null;
    const pnlPct = pnl != null ? (pnl / costBasis) * 100 : null;
    const dayChg = q?.change != null ? q.change * p.shares : null;

    if (mktVal != null) { totalValue += mktVal; totalDay += dayChg ?? 0; }
    totalCost += costBasis;

    const pnlStr = pnl != null
      ? `${fmtSign$(pnl)} (${fmtPct(pnlPct)})`
      : "—";
    const dayStr = dayChg != null
      ? `${fmtSign$(dayChg)} (${fmtPct(q.changePct)})`
      : "—";

    return `
      <div class="pf-row">
        <button class="pf-sym-btn" data-pf-analyze="${p.symbol}">${p.symbol}</button>
        <span class="pf-name">${q?.name ?? ""}</span>
        <span>${p.shares % 1 === 0 ? p.shares : p.shares.toFixed(3)}</span>
        <span>${fmt$(p.cost, 2)}</span>
        <span>${price != null ? fmt$(price, 2) : "—"}</span>
        <span>${mktVal != null ? fmt$(mktVal) : "—"}</span>
        <span class="${cls(pnl)}">${pnlStr}</span>
        <span class="${cls(dayChg)}">${dayStr}</span>
        <button class="pf-del-btn" data-pf-del="${p.symbol}" title="Remove">✕</button>
      </div>`;
  }).join("");

  list.innerHTML = `
    <div class="pf-row pf-hdr">
      <span>Symbol</span><span>Name</span><span>Shares</span>
      <span>Avg Cost</span><span>Price</span><span>Mkt Value</span>
      <span>Total P&L</span><span>Today</span><span></span>
    </div>${rows}`;

  const totalPnl = totalValue ? totalValue - totalCost : 0;
  const totalPnlPct = totalCost ? (totalPnl / totalCost) * 100 : 0;

  sumEl.innerHTML = `
    <div class="pf-sum-stat">
      <div class="pf-sum-lbl">Portfolio Value</div>
      <div class="pf-sum-val">${totalValue ? fmt$(totalValue) : "—"}</div>
    </div>
    <div class="pf-sum-stat">
      <div class="pf-sum-lbl">Total P&L</div>
      <div class="pf-sum-val ${cls(totalPnl)}">${totalValue ? `${fmtSign$(totalPnl)} (${fmtPct(totalPnlPct)})` : "—"}</div>
    </div>
    <div class="pf-sum-stat">
      <div class="pf-sum-lbl">Today's P&L</div>
      <div class="pf-sum-val ${cls(totalDay)}">${totalDay !== 0 ? fmtSign$(totalDay) : "—"}</div>
    </div>
    <div class="pf-sum-stat">
      <div class="pf-sum-lbl">Positions</div>
      <div class="pf-sum-val">${_positions.length}</div>
    </div>`;
}
