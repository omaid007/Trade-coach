import { apiFetch, fetchOHLC } from "./api.js";
import { initAutocomplete } from "./autocomplete.js";
import { computeAll } from "./indicators.js";
import { detectSetups } from "./setups.js";
import { f2 } from "./format.js";
import { fetchNews } from "./news.js";

const KEY = "tc_shortterm_v1";
const REFRESH_MS = 60_000;

let _onAnalyze = null;
let _timer = null;
let _analyzing = false;

function load() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
function save(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

function fmtVol(v) {
  if (!v) return "—";
  if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return String(v);
}

function pctStr(n) { return (n >= 0 ? "+" : "") + n.toFixed(2) + "%"; }
function cls(n) { return n > 0 ? "bull" : n < 0 ? "bear" : ""; }

function timeAgo(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function loadChart(sym) {
  const studies = encodeURIComponent(
    JSON.stringify([{ id: "RSI@tv-basicstudies" }, { id: "MACD@tv-basicstudies" }, { id: "Volume@tv-basicstudies" }])
  );
  const url = `https://s.tradingview.com/widgetembed/?frameElementId=st_tv&symbol=${encodeURIComponent(sym)}&interval=D&hidesidetoolbar=0&theme=dark&style=1&timezone=Etc%2FUTC&withdateranges=1&hideideas=1&studies=${studies}`;
  document.getElementById("st-chart").innerHTML =
    `<iframe id="st_tv" src="${url}" style="width:100%;height:100%;border:0;display:block;" allowtransparency="true" scrolling="no" allowfullscreen></iframe>`;
}

function indRow(label, val, color, note) {
  return `<div style="color:var(--text-dim);font-size:12px;">${label}</div>
          <div style="font-weight:600;color:${color || "var(--text)"};">${val}</div>
          <div style="font-size:11px;color:var(--text-faint);">${note || ""}</div>`;
}

function renderSetup(ind, setup, data, price) {
  const i = data.closes.length - 1;
  const rsi      = ind.rsi?.[i];
  const macdLine = ind.macd?.macd?.[i];
  const macdSig  = ind.macd?.signal?.[i];
  const macdHist = ind.macd?.hist?.[i];
  const atrVal   = ind.atr?.[i];
  const atrPct   = atrVal ? (atrVal / price * 100) : null;
  const vol      = data.volumes[i];
  const avgVol   = data.volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volRatio = avgVol > 0 ? vol / avgVol : null;
  const sma20    = ind.sma20?.[i];
  const sma50    = ind.sma50?.[i];
  const sma200   = ind.sma200?.[i];

  const rsiColor  = rsi > 70 ? "var(--red)" : rsi < 30 ? "var(--green)" : "var(--text)";
  const rsiNote   = rsi > 70 ? "Overbought" : rsi < 30 ? "Oversold" : rsi > 55 ? "Bullish" : rsi < 45 ? "Bearish" : "Neutral";
  const macdColor = macdHist != null ? (macdHist > 0 ? "var(--green)" : "var(--red)") : "var(--text)";
  const macdCross = macdLine != null && macdSig != null
    ? (macdLine > macdSig ? "Bullish" : "Bearish") : "—";
  const volColor = volRatio != null ? (volRatio > 1.5 ? "var(--green)" : volRatio < 0.7 ? "var(--red)" : "var(--text)") : "var(--text)";

  const score     = setup?.score ?? 0;
  const scoreColor = score >= 65 ? "var(--green)" : score >= 45 ? "var(--amber)" : "var(--red)";
  const dir = setup?.direction || "flat";
  const dirLabel = dir === "long" ? "LONG" : dir === "short" ? "SHORT" : "FLAT";
  const dirColor = dir === "long" ? "var(--green)" : dir === "short" ? "var(--red)" : "var(--text-dim)";

  const entryBlock = setup && dir !== "flat" ? `
    <div style="margin-top:14px;padding:10px 12px;background:var(--bg-elev-2);border-radius:8px;font-size:12px;display:flex;gap:16px;flex-wrap:wrap;">
      <div><span style="color:var(--text-dim);">Entry:</span> <strong>$${f2(setup.entry?.lo)}–$${f2(setup.entry?.hi)}</strong></div>
      <div><span style="color:var(--text-dim);">Stop:</span> <strong style="color:var(--red);">$${f2(setup.stop)}</strong></div>
      <div><span style="color:var(--text-dim);">T1:</span> <strong style="color:var(--green);">$${f2(setup.targets?.[0])}</strong></div>
      <div><span style="color:var(--text-dim);">T2:</span> <strong style="color:var(--green);">$${f2(setup.targets?.[1])}</strong></div>
    </div>` : "";

  document.getElementById("st-setup").innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
      <div>
        <div style="font-weight:600;font-size:14px;">${setup?.name || "No Clear Setup"}</div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:3px;max-width:280px;">${setup?.thesis || ""}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:20px;font-weight:700;color:${dirColor};">${dirLabel}</div>
        <div style="font-size:11px;color:var(--text-faint);">${Math.round(score)}% confidence</div>
      </div>
    </div>
    <div style="background:var(--bg-elev-2);border-radius:4px;height:6px;margin-bottom:14px;overflow:hidden;">
      <div style="height:100%;width:${score}%;background:${scoreColor};border-radius:4px;"></div>
    </div>
    <div class="st-ind-grid">
      ${indRow("RSI (14)",    rsi != null ? rsi.toFixed(1) : "—",   rsiColor,   rsiNote)}
      ${indRow("MACD",        macdCross,                             macdColor,  macdHist != null ? `Hist ${macdHist > 0 ? "+" : ""}${macdHist.toFixed(3)}` : "")}
      ${indRow("ATR (14)",    atrVal != null ? `$${f2(atrVal)}` : "—", "var(--text)", atrPct != null ? `${atrPct.toFixed(1)}% of price` : "")}
      ${indRow("Volume",      fmtVol(vol),                           volColor,   volRatio != null ? `${volRatio.toFixed(1)}x avg` : "")}
      ${indRow("SMA 20",      sma20 != null ? `$${f2(sma20)}` : "—",  price > sma20 ? "var(--green)" : "var(--red)", price > sma20 ? "Above" : "Below")}
      ${indRow("SMA 50",      sma50 != null ? `$${f2(sma50)}` : "—",  price > sma50 ? "var(--green)" : "var(--red)", price > sma50 ? "Above" : "Below")}
      ${indRow("SMA 200",     sma200 != null ? `$${f2(sma200)}` : "—", price > sma200 ? "var(--green)" : "var(--red)", price > sma200 ? "Bull market structure" : "Bear market structure")}
    </div>
    ${entryBlock}`;
}

function renderCatalysts(events) {
  const el = document.getElementById("st-catalysts");
  if (!el) return;
  const rows = [];
  if (events?.earningsDate)   rows.push(`<div class="st-catalyst-row"><span class="st-cat-badge" style="background:rgba(91,157,255,.15);color:var(--blue);">Earnings</span><span>${events.earningsDate}</span></div>`);
  if (events?.dividendDate)   rows.push(`<div class="st-catalyst-row"><span class="st-cat-badge" style="background:rgba(63,209,122,.15);color:var(--green);">Dividend</span><span>${events.dividendDate}</span></div>`);
  if (events?.exDividendDate) rows.push(`<div class="st-catalyst-row"><span class="st-cat-badge" style="background:rgba(63,209,122,.1);color:var(--green);">Ex-Div</span><span>${events.exDividendDate}</span></div>`);
  el.innerHTML = rows.length
    ? `<div style="display:flex;flex-direction:column;gap:8px;">${rows.join("")}</div>`
    : `<div style="color:var(--text-faint);font-size:12px;padding:4px 0;">No upcoming events found.</div>`;
}

function renderNewsItems(articles) {
  const el = document.getElementById("st-news");
  if (!el) return;
  if (!articles?.length) {
    el.innerHTML = `<div style="color:var(--text-faint);font-size:12px;padding:4px 0;">No news available.</div>`;
    return;
  }
  el.innerHTML = articles.slice(0, 7).map(a => `
    <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="st-news-item">
      <div class="st-news-title">${a.title}</div>
      <div class="st-news-meta">${a.publisher || ""}${a.publishedAt ? " · " + timeAgo(a.publishedAt) : ""}</div>
    </a>`).join("");
}

async function analyzeSymbol(sym) {
  if (_analyzing || !sym) return;
  _analyzing = true;

  const nameEl   = document.getElementById("st-sym-name");
  const priceEl  = document.getElementById("st-sym-price");
  const changeEl = document.getElementById("st-sym-change");
  const setupEl  = document.getElementById("st-setup");
  const section1 = document.getElementById("st-analysis-section");
  const section2 = document.getElementById("st-news-section");

  document.getElementById("st-sym-input").value = sym;
  if (nameEl)   nameEl.textContent  = "";
  if (priceEl)  priceEl.textContent = "";
  if (changeEl) { changeEl.textContent = ""; changeEl.className = "pill"; }

  if (section1) section1.style.display = "";
  if (section2) section2.style.display = "";

  loadChart(sym);
  if (setupEl) setupEl.innerHTML = `<div class="loading">Analyzing ${sym}…</div>`;

  const catEl  = document.getElementById("st-catalysts");
  const newsEl = document.getElementById("st-news");
  if (catEl)  catEl.innerHTML  = `<div class="loading">Loading…</div>`;
  if (newsEl) newsEl.innerHTML = `<div class="loading">Loading news…</div>`;

  try {
    const [data, newsData] = await Promise.all([
      fetchOHLC(sym, "6mo", "1d"),
      fetchNews(sym).catch(() => ({ articles: [], events: {} })),
    ]);

    const ind    = computeAll(data);
    const setups = detectSetups(data, ind, "swing");
    const top    = setups[0];
    const price  = data.closes.at(-1);
    const prev   = data.meta?.prevClose ?? data.closes.at(-2) ?? price;
    const chgPct = ((price - prev) / prev) * 100;

    if (nameEl)  nameEl.textContent  = data.meta?.name || "";
    if (priceEl) priceEl.textContent = `$${f2(price)}`;
    if (changeEl) {
      changeEl.textContent = `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%`;
      changeEl.className   = `pill ${chgPct >= 0 ? "bull" : "bear"}`;
    }

    renderSetup(ind, top, data, price);
    renderCatalysts(newsData?.events);
    renderNewsItems(newsData?.articles);
  } catch (e) {
    if (setupEl) setupEl.innerHTML = `<span style="color:var(--red);">Error: ${e.message}</span>`;
  } finally {
    _analyzing = false;
  }
}

/* ── Watchlist ── */
async function refresh() {
  const container = document.getElementById("st-rows");
  if (!container) return;

  const symbols = load();
  if (!symbols.length) {
    container.innerHTML = `<div class="wl-empty">No symbols yet — add one above.</div>`;
    _timer = setTimeout(refresh, REFRESH_MS);
    return;
  }

  try {
    const { quotes } = await apiFetch(`/api/quotes?symbols=${symbols.join(",")}`);
    const map = Object.fromEntries(quotes.map(q => [q.symbol, q]));
    container.innerHTML = symbols.map(sym => {
      const q = map[sym];
      if (!q) return `
        <div class="wl-row" data-sym="${sym}">
          <button class="wl-sym" data-sym="${sym}">${sym}</button>
          <span class="wl-name wl-name-inline" style="color:var(--text-faint);">—</span>
          <button class="wl-remove" data-sym="${sym}">✕</button>
        </div>`;
      return `
        <div class="wl-row" data-sym="${sym}">
          <button class="wl-sym" data-sym="${sym}">${sym}</button>
          <span class="wl-name wl-name-inline">${q.name || ""}</span>
          <span class="wl-price">$${q.price?.toFixed(2) ?? "—"}</span>
          <span class="wl-chg ${cls(q.changePct)}">${pctStr(q.changePct ?? 0)}</span>
          <span style="font-size:11px;color:var(--text-dim);">Vol ${fmtVol(q.volume)}</span>
          <button class="wl-remove" data-sym="${sym}">✕</button>
        </div>`;
    }).join("");
  } catch {}

  _timer = setTimeout(refresh, REFRESH_MS);
}

function addSymbol() {
  const input = document.getElementById("st-add-input");
  const sym   = (input?.value || "").trim().toUpperCase();
  if (!sym) return;
  const list = load();
  if (!list.includes(sym)) { list.push(sym); save(list); }
  if (input) input.value = "";
  refresh();
}

function removeSymbol(sym) {
  save(load().filter(s => s !== sym));
  refresh();
}

export function initShortTerm(onAnalyze) {
  _onAnalyze = onAnalyze;

  const symInput = document.getElementById("st-sym-input");
  const symBtn   = document.getElementById("st-sym-btn");

  symBtn?.addEventListener("click", () => {
    const sym = symInput?.value.trim().toUpperCase();
    if (sym) analyzeSymbol(sym);
  });
  symInput?.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      const sym = symInput.value.trim().toUpperCase();
      if (sym) analyzeSymbol(sym);
    }
  });
  if (symInput) initAutocomplete(symInput, sym => { symInput.value = sym; analyzeSymbol(sym); });

  document.getElementById("st-add-btn")?.addEventListener("click", addSymbol);
  document.getElementById("st-add-input")?.addEventListener("keydown", e => {
    if (e.key === "Enter") addSymbol();
  });
  const addInput = document.getElementById("st-add-input");
  if (addInput) initAutocomplete(addInput, sym => { addInput.value = sym; addSymbol(); });

  document.getElementById("st-rows")?.addEventListener("click", e => {
    const sym = e.target.dataset.sym;
    if (e.target.classList.contains("wl-sym") && sym) analyzeSymbol(sym);
    if (e.target.classList.contains("wl-remove") && sym) removeSymbol(sym);
  });
}

export function shortTermTabActivated() { clearTimeout(_timer); refresh(); }
export function shortTermTabDeactivated() { clearTimeout(_timer); _timer = null; }
