import { apiFetch } from "./api.js";
import { initAutocomplete } from "./autocomplete.js";
import { f2 } from "./format.js";

const KEY = "tc_longterm_v1";
const REFRESH_MS = 60_000;

let _onAnalyze = null;
let _timer = null;
let _loading = false;

function load() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
function save(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

function fmtCap(v) {
  if (!v) return "—";
  if (v >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (v >= 1e9)  return "$" + (v / 1e9).toFixed(1)  + "B";
  if (v >= 1e6)  return "$" + (v / 1e6).toFixed(0)  + "M";
  return "$" + v;
}

function fmtB(v) { return v != null ? "$" + (v / 1e9).toFixed(1) + "B" : "—"; }
function fmtPct(v, dec = 1) { return v != null ? `${(v * 100) >= 0 ? "+" : ""}${(v * 100).toFixed(dec)}%` : "—"; }
function posneg(v) { return v != null ? (v > 0 ? "var(--green)" : v < 0 ? "var(--red)" : "var(--text)") : "var(--text)"; }
function pctStr(n) { return (n >= 0 ? "+" : "") + n.toFixed(2) + "%"; }
function cls(n)    { return n > 0 ? "bull" : n < 0 ? "bear" : ""; }

function range52Bar(price, low, high) {
  if (!price || !low || !high || high <= low) return "";
  const pct = Math.round(((price - low) / (high - low)) * 100);
  return `<div style="display:flex;flex-direction:column;gap:2px;min-width:90px;">
    <div style="background:var(--bg-elev-2);border-radius:3px;height:4px;position:relative;overflow:hidden;">
      <div style="position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:var(--accent, var(--blue));"></div>
    </div>
    <div style="font-size:10px;color:var(--text-faint);">$${low.toFixed(0)}–$${high.toFixed(0)}</div>
  </div>`;
}

function loadChart(sym) {
  const url = `https://s.tradingview.com/widgetembed/?frameElementId=lt_tv&symbol=${encodeURIComponent(sym)}&interval=W&hidesidetoolbar=0&theme=dark&style=1&timezone=Etc%2FUTC&withdateranges=1&hideideas=1`;
  document.getElementById("lt-chart").innerHTML =
    `<iframe id="lt_tv" src="${url}" style="width:100%;height:100%;border:0;display:block;" allowtransparency="true" scrolling="no" allowfullscreen></iframe>`;
}

function fundRow(label, val, color, note) {
  return `<div style="color:var(--text-dim);font-size:12px;">${label}</div>
          <div style="font-weight:600;color:${color || "var(--text)"};">${val}</div>
          <div style="font-size:11px;color:var(--text-faint);">${note || ""}</div>`;
}

function renderValuation(f) {
  const el = document.getElementById("lt-valuation");
  if (!el) return;

  const price = f.price;
  const pe = f.pe != null ? f.pe.toFixed(1) : "—";
  const fpe = f.forwardPE != null ? f.forwardPE.toFixed(1) : "—";
  const pb  = f.priceToBook != null ? f.priceToBook.toFixed(2) : "—";
  const beta = f.beta != null ? f.beta.toFixed(2) : "—";
  const betaNote = f.beta != null ? (f.beta > 1.5 ? "High vol" : f.beta < 0.7 ? "Low vol" : "Moderate vol") : "";

  const earningsBlock = f.nextEarnings
    ? `<div style="margin-top:12px;padding:8px 10px;background:rgba(91,157,255,.12);border-left:3px solid var(--blue);border-radius:0 6px 6px 0;font-size:12px;">
        <span style="color:var(--blue);font-weight:600;">Next earnings:</span> ${f.nextEarnings}
        ${f.epsEst ? ` · EPS est: <strong>${f.epsEst}</strong>` : ""}
        ${f.revEst ? ` · Rev est: <strong>${f.revEst}</strong>` : ""}
      </div>` : "";

  el.innerHTML = `
    <div class="lt-fund-grid">
      ${fundRow("P/E (TTM)",     pe,   "var(--text)", "Trailing")}
      ${fundRow("Forward P/E",   fpe,  "var(--text)", "Next 12M est")}
      ${fundRow("EPS (TTM)",     f.eps != null ? `$${f.eps.toFixed(2)}` : "—", "var(--text)", "")}
      ${fundRow("Fwd EPS",       f.forwardEps != null ? `$${f.forwardEps.toFixed(2)}` : "—", "var(--text)", "Next 12M est")}
      ${fundRow("Price / Book",  pb,   "var(--text)", "")}
      ${fundRow("Beta",          beta, "var(--text)", betaNote)}
      ${fundRow("52W Low",       f.low52  != null ? `$${f2(f.low52)}`  : "—", "var(--text)", "")}
      ${fundRow("52W High",      f.high52 != null ? `$${f2(f.high52)}` : "—", "var(--text)", "")}
    </div>
    ${earningsBlock}`;
}

function renderGrowthHealth(f) {
  const el = document.getElementById("lt-growth");
  if (!el) return;

  const dr = f.dividendRate;
  const dy = f.dividendYield;
  const divRows = dy > 0 ? [
    fundRow("Dividend Yield", dy != null ? (dy * 100).toFixed(2) + "%" : "—", "var(--green)", "Annual"),
    fundRow("Dividend Rate",  dr != null ? `$${dr.toFixed(2)}` : "—", "var(--text)", "Per share/yr"),
    fundRow("Payout Ratio",   f.payoutRatio != null ? (f.payoutRatio * 100).toFixed(0) + "%" : "—", "var(--text)", ""),
    fundRow("Ex-Div Date",    f.exDivDate || "—", "var(--text)", ""),
  ] : [];

  el.innerHTML = `
    <div class="lt-fund-grid">
      ${fundRow("Revenue Growth",   fmtPct(f.revenueGrowth),   posneg(f.revenueGrowth),   "YoY")}
      ${fundRow("Earnings Growth",  fmtPct(f.earningsGrowth),  posneg(f.earningsGrowth),  "YoY")}
      ${fundRow("Gross Margin",     f.grossMargin     != null ? (f.grossMargin * 100).toFixed(1)     + "%" : "—", "var(--text)", "")}
      ${fundRow("Operating Margin", f.operatingMargin != null ? (f.operatingMargin * 100).toFixed(1) + "%" : "—", f.operatingMargin > 0.2 ? "var(--green)" : "var(--text)", "")}
      ${fundRow("Profit Margin",    f.profitMargin    != null ? (f.profitMargin * 100).toFixed(1)    + "%" : "—", posneg(f.profitMargin), "Net")}
      ${fundRow("ROE",              f.roe != null ? (f.roe * 100).toFixed(1) + "%" : "—", f.roe > 0.15 ? "var(--green)" : "var(--text)", "Return on Equity")}
      ${fundRow("ROA",              f.roa != null ? (f.roa * 100).toFixed(1) + "%" : "—", "var(--text)", "Return on Assets")}
      ${fundRow("Debt / Equity",    f.debtToEquity != null ? f.debtToEquity.toFixed(2) : "—", f.debtToEquity > 2 ? "var(--red)" : "var(--text)", f.debtToEquity > 2 ? "High leverage" : "")}
      ${fundRow("Current Ratio",    f.currentRatio != null ? f.currentRatio.toFixed(2) : "—", f.currentRatio < 1 ? "var(--red)" : "var(--text)", f.currentRatio < 1 ? "Watch — below 1" : "Liquid")}
      ${fundRow("Free Cash Flow",   fmtB(f.freeCashflow), posneg(f.freeCashflow), "TTM")}
      ${fundRow("Revenue",          fmtB(f.totalRevenue), "var(--text)", "TTM")}
      ${divRows.join("")}
    </div>`;
}

function renderAnalysts(f) {
  const el = document.getElementById("lt-analysts");
  if (!el) return;

  const recLabel = { strong_buy: "Strong Buy", buy: "Buy", hold: "Hold", underperform: "Underperform", sell: "Sell" };
  const recColor = { strong_buy: "var(--green)", buy: "var(--green)", hold: "var(--amber)", underperform: "var(--red)", sell: "var(--red)" };

  const targetHtml = f.targetMean != null ? `
    <div style="display:flex;gap:20px;margin-bottom:14px;flex-wrap:wrap;align-items:flex-end;">
      <div style="text-align:center;">
        <div style="font-size:26px;font-weight:700;color:var(--blue);">$${f2(f.targetMean)}</div>
        <div style="font-size:11px;color:var(--text-faint);">Mean target</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:16px;font-weight:600;color:var(--green);">$${f2(f.targetHigh)}</div>
        <div style="font-size:11px;color:var(--text-faint);">High</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:16px;font-weight:600;color:var(--red);">$${f2(f.targetLow)}</div>
        <div style="font-size:11px;color:var(--text-faint);">Low</div>
      </div>
      ${f.analystCount ? `<div style="text-align:center;">
        <div style="font-size:16px;font-weight:600;">${f.analystCount}</div>
        <div style="font-size:11px;color:var(--text-faint);">Analysts</div>
      </div>` : ""}
    </div>` : "";

  const consensusHtml = f.recKey ? `
    <div style="margin-bottom:14px;">
      <span style="font-size:20px;font-weight:700;color:${recColor[f.recKey] || "var(--text)"};">${recLabel[f.recKey] || f.recKey}</span>
      <span style="font-size:12px;color:var(--text-faint);margin-left:8px;">consensus</span>
    </div>` : "";

  const sb = f.recStrongBuy || 0, b = f.recBuy || 0, h = f.recHold || 0,
        s  = f.recSell || 0, ss = f.recStrongSell || 0;
  const total = sb + b + h + s + ss;

  const barsHtml = total > 0 ? (() => {
    const bar = (n, color, label) => {
      if (!n) return "";
      const pct = Math.round((n / total) * 100);
      return `<div style="flex:${n};display:flex;flex-direction:column;align-items:center;gap:3px;">
        <div style="font-size:10px;color:var(--text-faint);">${n}</div>
        <div style="height:32px;width:100%;background:${color};border-radius:3px 3px 0 0;" title="${label}: ${n} (${pct}%)"></div>
        <div style="font-size:9px;color:var(--text-faint);text-align:center;line-height:1.2;">${label}</div>
      </div>`;
    };
    return `<div style="display:flex;gap:3px;align-items:flex-end;margin-top:4px;">
      ${bar(sb, "var(--green)", "Strong Buy")}
      ${bar(b,  "#7dd87d",     "Buy")}
      ${bar(h,  "var(--amber)","Hold")}
      ${bar(s,  "#ff8a94",     "Sell")}
      ${bar(ss, "var(--red)",  "Strong Sell")}
    </div>`;
  })() : "";

  el.innerHTML = targetHtml + consensusHtml + barsHtml;
  if (!targetHtml && !consensusHtml && !barsHtml) {
    el.innerHTML = `<div style="color:var(--text-faint);font-size:12px;padding:4px 0;">No analyst data available.</div>`;
  }
}

async function analyzeSymbol(sym) {
  if (_loading || !sym) return;
  _loading = true;

  const nameEl   = document.getElementById("lt-sym-name");
  const priceEl  = document.getElementById("lt-sym-price");
  const changeEl = document.getElementById("lt-sym-change");
  const capEl    = document.getElementById("lt-sym-mktcap");
  const section1 = document.getElementById("lt-analysis-section");
  const section2 = document.getElementById("lt-details-section");

  document.getElementById("lt-sym-input").value = sym;
  if (nameEl)   nameEl.textContent  = "";
  if (priceEl)  priceEl.textContent = "";
  if (changeEl) { changeEl.textContent = ""; changeEl.className = "pill"; }
  if (capEl)    capEl.textContent   = "";

  if (section1) section1.style.display = "";
  if (section2) section2.style.display = "";

  loadChart(sym);

  const valEl    = document.getElementById("lt-valuation");
  const growthEl = document.getElementById("lt-growth");
  const analEl   = document.getElementById("lt-analysts");
  if (valEl)    valEl.innerHTML    = `<div class="loading">Loading fundamentals…</div>`;
  if (growthEl) growthEl.innerHTML = `<div class="loading">Loading…</div>`;
  if (analEl)   analEl.innerHTML   = `<div class="loading">Loading analyst data…</div>`;

  try {
    const f = await apiFetch(`/api/fundamentals?symbol=${encodeURIComponent(sym)}`);

    if (nameEl)  nameEl.textContent  = f.name || sym;
    if (priceEl && f.price != null)  priceEl.textContent  = `$${f2(f.price)}`;
    if (changeEl && f.changePct != null) {
      const pct = f.changePct * 100;
      changeEl.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
      changeEl.className   = `pill ${pct >= 0 ? "bull" : "bear"}`;
    }
    if (capEl && f.marketCap) capEl.textContent = fmtCap(f.marketCap);

    renderValuation(f);
    renderGrowthHealth(f);
    renderAnalysts(f);
  } catch (e) {
    if (valEl) valEl.innerHTML = `<span style="color:var(--red);">Error: ${e.message}</span>`;
  } finally {
    _loading = false;
  }
}

/* ── Watchlist ── */
async function refresh() {
  const container = document.getElementById("lt-rows");
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
          <span style="font-size:11px;color:var(--text-dim);">${fmtCap(q.marketCap)}</span>
          ${range52Bar(q.price, q.low52, q.high52)}
          <button class="wl-remove" data-sym="${sym}">✕</button>
        </div>`;
    }).join("");
  } catch {}

  _timer = setTimeout(refresh, REFRESH_MS);
}

function addSymbol() {
  const input = document.getElementById("lt-add-input");
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

export function initLongTerm(onAnalyze) {
  _onAnalyze = onAnalyze;

  const symInput = document.getElementById("lt-sym-input");
  const symBtn   = document.getElementById("lt-sym-btn");

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

  document.getElementById("lt-add-btn")?.addEventListener("click", addSymbol);
  document.getElementById("lt-add-input")?.addEventListener("keydown", e => {
    if (e.key === "Enter") addSymbol();
  });
  const addInput = document.getElementById("lt-add-input");
  if (addInput) initAutocomplete(addInput, sym => { addInput.value = sym; addSymbol(); });

  document.getElementById("lt-rows")?.addEventListener("click", e => {
    const sym = e.target.dataset.sym;
    if (e.target.classList.contains("wl-sym") && sym) analyzeSymbol(sym);
    if (e.target.classList.contains("wl-remove") && sym) removeSymbol(sym);
  });
}

export function longTermTabActivated()   { clearTimeout(_timer); refresh(); }
export function longTermTabDeactivated() { clearTimeout(_timer); _timer = null; }
