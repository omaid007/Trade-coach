import { fetchOHLC } from "./api.js";

const STORAGE_KEY = "tc_watchlist_v1";
const MARKET = ["SPY", "QQQ", "IWM", "VIX", "DIA"];
const REFRESH_MS = 60_000;

let _onAnalyze = null;
let _timer = null;

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function save(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }

async function fetchQuote(symbol) {
  const data = await fetchOHLC(symbol, "1d", "1d");
  const price = data.meta.price ?? data.closes.at(-1) ?? 0;
  const prev  = data.meta.prevClose ?? price;
  const change    = price - prev;
  const changePct = prev ? (change / prev) * 100 : 0;
  return { symbol, name: data.meta.name, price, change, changePct };
}

function pctStr(n) { return (n >= 0 ? "+" : "") + n.toFixed(2) + "%"; }
function f2(n)     { return n?.toFixed(2) ?? "—"; }
function cls(n)    { return n > 0 ? "bull" : n < 0 ? "bear" : ""; }

async function renderRow(container, symbol, isMarket) {
  let q;
  try { q = await fetchQuote(symbol); }
  catch { return; }

  const existing = container.querySelector(`[data-sym="${symbol}"]`);
  const html = isMarket
    ? `<div class="wl-row wl-market" data-sym="${symbol}">
        <div class="wl-market-top">
          <button class="wl-sym" data-sym="${symbol}">${symbol}</button>
          <span class="wl-chg ${cls(q.changePct)}">${pctStr(q.changePct)}</span>
        </div>
        <div class="wl-name">${q.name}</div>
        <div class="wl-price">$${f2(q.price)}</div>
      </div>`
    : `<div class="wl-row" data-sym="${symbol}">
        <button class="wl-sym" data-sym="${symbol}">${symbol}</button>
        <span class="wl-name wl-name-inline">${q.name}</span>
        <span class="wl-price">$${f2(q.price)}</span>
        <span class="wl-chg ${cls(q.changePct)}">${pctStr(q.changePct)}</span>
        <button class="wl-remove" data-sym="${symbol}">✕</button>
      </div>`;
  if (existing) {
    existing.outerHTML = html;
  } else {
    container.insertAdjacentHTML("beforeend", html);
  }
}

async function refresh() {
  const market = document.getElementById("wl-market-rows");
  const listEl = document.getElementById("wl-list-rows");
  if (!market || !listEl) return;

  market.innerHTML = "";
  for (const sym of MARKET) renderRow(market, sym, true);

  const watchlist = load();
  listEl.innerHTML = watchlist.length
    ? ""
    : `<div class="wl-empty">No tickers yet — add one above.</div>`;
  for (const sym of watchlist) renderRow(listEl, sym, false);

  _timer = setTimeout(refresh, REFRESH_MS);
}

function addSymbol() {
  const input = document.getElementById("wl-add-input");
  const sym = (input?.value || "").trim().toUpperCase();
  if (!sym) return;
  const list = load();
  if (!list.includes(sym)) {
    list.push(sym);
    save(list);
    rerenderList();
  }
  if (input) input.value = "";
}

function removeSymbol(sym) {
  save(load().filter(s => s !== sym));
  rerenderList();
}

function rerenderList() {
  const container = document.getElementById("wl-list-rows");
  if (!container) return;
  const list = load();
  container.innerHTML = list.length
    ? ""
    : `<div class="wl-empty">No tickers yet — add one above.</div>`;
  for (const sym of list) renderRow(container, sym, false);
}

export function initWatchlist(onAnalyze) {
  _onAnalyze = onAnalyze;

  document.getElementById("wl-add-btn")?.addEventListener("click", addSymbol);
  document.getElementById("wl-add-input")?.addEventListener("keydown", e => {
    if (e.key === "Enter") addSymbol();
  });

  document.getElementById("wl-market-rows")?.addEventListener("click", e => {
    const sym = e.target.dataset.sym;
    if (e.target.classList.contains("wl-sym") && sym) _onAnalyze?.(sym);
  });

  document.getElementById("wl-list-rows")?.addEventListener("click", e => {
    const sym = e.target.dataset.sym;
    if (e.target.classList.contains("wl-sym") && sym) _onAnalyze?.(sym);
    if (e.target.classList.contains("wl-remove") && sym) removeSymbol(sym);
  });
}

export function watchlistTabActivated() {
  clearTimeout(_timer);
  refresh();
}

export function watchlistTabDeactivated() {
  clearTimeout(_timer);
  _timer = null;
}
