import { apiFetch } from "./api.js";

let _screen = "gainers";
let _busy = false;
let _onAnalyze = null;

export function initScreener(onAnalyze) {
  _onAnalyze = onAnalyze;

  document.querySelectorAll(".scr-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".scr-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _screen = btn.dataset.screen;
      fetchScreen();
    });
  });

  document.getElementById("scr-refresh-btn").addEventListener("click", fetchScreen);

  document.getElementById("scr-results").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-scr-sym]");
    if (btn) _onAnalyze(btn.dataset.scrSym);
  });

  fetchScreen();
}

async function fetchScreen() {
  if (_busy) return;
  _busy = true;
  const el = document.getElementById("scr-results");
  el.innerHTML = `<div class="loading">Loading…</div>`;

  try {
    const { quotes = [] } = await apiFetch(`/api/screener?screen=${_screen}`);

    if (!quotes.length) {
      el.innerHTML = `<div class="scr-empty">No results returned — market may be closed.</div>`;
      return;
    }

    const rows = quotes.map((q, i) => {
      const pctCls = (q.changePct ?? 0) >= 0 ? "pos" : "neg";
      const pctStr = q.changePct != null ? `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%` : "—";
      const priceStr = q.price != null ? `$${q.price.toFixed(2)}` : "—";
      const volStr = fmtVol(q.volume);
      const capStr = fmtCap(q.marketCap);

      return `
        <div class="scr-row">
          <span class="scr-rank">${i + 1}</span>
          <button class="scr-sym-btn" data-scr-sym="${q.symbol}">${q.symbol}</button>
          <span class="scr-name">${q.name}</span>
          <span class="scr-price">${priceStr}</span>
          <span class="scr-chg ${pctCls}">${pctStr}</span>
          <span class="scr-vol">${volStr}</span>
          <span class="scr-cap">${capStr}</span>
        </div>`;
    }).join("");

    el.innerHTML = `
      <div class="scr-row scr-hdr">
        <span>#</span><span>Symbol</span><span>Name</span>
        <span>Price</span><span>Change</span><span>Volume</span><span>Mkt Cap</span>
      </div>${rows}`;
  } catch (err) {
    el.innerHTML = `<div class="error">Failed to load: ${err.message}</div>`;
  } finally {
    _busy = false;
  }
}

function fmtVol(v) {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function fmtCap(v) {
  if (v == null) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v}`;
}
