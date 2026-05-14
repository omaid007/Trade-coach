/**
 * All DOM rendering. Each renderX() function paints one section of the page.
 * No business logic here — read inputs, write to the DOM.
 */

import { STYLE_CONFIG } from "./config.js";
import { f0, f2, fchg, fpct, sgn } from "./format.js";
import { brokerLabel, brokerSteps } from "./brokers.js";

/* ================== HEADER / SUMMARY ================== */
export function renderHeader(d, ind, top, style) {
  const i = d.closes.length - 1;
  const price = d.closes[i];
  const prev = d.meta.prevClose || d.closes[Math.max(0, i - 1)];
  const chg = price - prev;
  const pct = (chg / prev) * 100;

  document.getElementById("symLabel").textContent = d.meta.symbol;
  document.getElementById("symName").textContent = `${d.meta.name} · ${d.meta.exchange}`;
  document.getElementById("priceLabel").textContent = "$" + f2(price);
  document.getElementById("changeLabel").innerHTML =
    `<span class="${sgn(chg)}">${fchg(chg)} (${fpct(pct)})</span>`;

  // Trend pill
  const sma50 = ind.sma50[i], sma200 = ind.sma200[i];
  let trend = "neutral", trendCls = "";
  if (sma50 && sma200 && price > sma50 && sma50 > sma200) { trend = "uptrend"; trendCls = "bull"; }
  else if (sma50 && sma200 && price < sma50 && sma50 < sma200) { trend = "downtrend"; trendCls = "bear"; }
  document.getElementById("trendPill").textContent = "trend: " + trend;
  document.getElementById("trendPill").className = "pill " + trendCls;

  // Momentum pill
  const r = ind.rsi[i];
  const momo = r == null ? "—" :
    r > 70 ? "overbought" :
    r < 30 ? "oversold" :
    r > 55 ? "bullish" :
    r < 45 ? "bearish" : "neutral";
  const momoCls = r == null ? "" : r > 55 ? "bull" : r < 45 ? "bear" : "";
  document.getElementById("momoPill").textContent =
    "momentum: " + momo + (r != null ? ` (RSI ${r.toFixed(0)})` : "");
  document.getElementById("momoPill").className = "pill " + momoCls;

  // Volatility pill
  const a = ind.atr[i];
  const atrPct = a ? (a / price) * 100 : null;
  const vol = atrPct == null ? "—" :
    atrPct > 4 ? "high" :
    atrPct > 2 ? "moderate" : "low";
  document.getElementById("volPill").textContent =
    "volatility: " + vol + (atrPct != null ? ` (ATR ${atrPct.toFixed(1)}%)` : "");

  // Verdict pill
  const verdict = document.getElementById("verdict");
  if (top.direction === "long" && top.score >= 55) {
    verdict.textContent = "BUY · " + Math.round(top.score) + "%";
    verdict.className = "verdict long";
  } else if (top.direction === "short" && top.score >= 55) {
    verdict.textContent = "SELL · " + Math.round(top.score) + "%";
    verdict.className = "verdict short";
  } else {
    verdict.textContent = "HOLD / WAIT";
    verdict.className = "verdict flat";
  }

  document.getElementById("oneLiner").innerHTML =
    `<strong>${STYLE_CONFIG[style].label}:</strong> ${top.thesis}`;
}

/* ================== LIVE TICK UPDATE ================== */
export function renderTick(tick) {
  if (!(tick.price > 0)) return;
  const priceEl  = document.getElementById("priceLabel");
  const changeEl = document.getElementById("changeLabel");
  if (priceEl)  priceEl.textContent = "$" + f2(tick.price);
  if (changeEl && tick.change != null) {
    const chg = tick.change;
    const pct = tick.prevClose ? (chg / tick.prevClose) * 100 : (tick.changePercent ?? 0) * 100;
    changeEl.innerHTML = `<span class="${chg >= 0 ? "pos" : "neg"}">${fchg(chg)} (${fpct(pct)})</span>`;
  }
}

/* ================== TRADINGVIEW EMBED ================== */
export function renderTV(symbol, style) {
  const intervalMap = { day: "15", swing: "D", position: "W" };
  const interval = intervalMap[style] || "D";
  const url =
    `https://s.tradingview.com/widgetembed/?frameElementId=tv_chart` +
    `&symbol=${encodeURIComponent(symbol)}&interval=${interval}` +
    `&hidesidetoolbar=0&theme=dark&style=1&timezone=Etc/UTC` +
    `&withdateranges=1&hideideas=1` +
    `&studies=%5B%22MASimple%40tv-basicstudies%22%2C%22RSI%40tv-basicstudies%22%5D`;
  document.getElementById("tv-container").innerHTML =
    `<iframe src="${url}" allowtransparency="true" scrolling="no" allowfullscreen></iframe>`;
}

/* ================== INDICATORS PANEL ================== */
export function renderIndicators(d, ind, top) {
  const i = d.closes.length - 1;
  const price = d.closes[i];

  const vwapVal = ind.vwap ? ind.vwap[i] : null;
  const divRow = ind.rsiDiv?.description
    ? `<div class="ind-row"><span class="ind-label">RSI divergence</span><span class="ind-val" style="color:var(--${ind.rsiDiv.type?.includes("bull") ? "green" : "red"})">${ind.rsiDiv.description}</span></div>`
    : "";

  const rows = [
    ["20-period MA", ind.sma20[i], (v) => "$" + f2(v) + (v ? ` · ${price > v ? "above" : "below"}` : "")],
    ["50-period MA", ind.sma50[i], (v) => "$" + f2(v) + (v ? ` · ${price > v ? "above" : "below"}` : "")],
    ["200-period MA", ind.sma200[i], (v) => "$" + f2(v) + (v ? ` · ${price > v ? "above" : "below"}` : "")],
    ["RSI(14)", ind.rsi[i], (v) =>
      v ? v.toFixed(1) + (v > 70 ? " · overbought" : v < 30 ? " · oversold" : v > 50 ? " · bullish" : " · bearish") : "—"],
    ["MACD histogram", ind.macd.hist[i], (v) =>
      v == null ? "—" : v.toFixed(3) + (v > 0 ? " · bullish" : " · bearish")],
    ["ATR(14)", ind.atr[i], (v) =>
      v == null ? "—" : "$" + f2(v) + ` · ${((v / price) * 100).toFixed(1)}%`],
    ["VWAP", vwapVal, (v) => v == null ? "—" : "$" + f2(v) + ` · ${price > v ? "above" : "below"}`],
    ["Bollinger upper", ind.bb.upper[i], (v) => "$" + f2(v)],
    ["Bollinger lower", ind.bb.lower[i], (v) => "$" + f2(v)],
  ];

  document.getElementById("indicators").innerHTML = rows
    .map(([label, v, fmt]) =>
      `<div class="ind-row"><span class="ind-label">${label}</span><span class="ind-val">${fmt(v)}</span></div>`
    )
    .join("") + divRow;

  document.getElementById("confFill").style.width = Math.min(100, top.score) + "%";
  document.getElementById("confText").textContent =
    `${Math.round(top.score)}% confluence · ${(top.signals || []).join(" · ")}`;
  document.getElementById("setupName").textContent = top.name;
}

/* ================== TRADE PLAN CARD ================== */

function rrBar(plan) {
  const { direction, entry, stop, targets } = plan;
  const t1 = targets[0]?.price, t2 = targets[1]?.price;
  if (!t1 || !t2) return "";

  const isLong = direction === "long";
  const lo = isLong ? stop : t2;
  const hi = isLong ? t2   : stop;
  const range = hi - lo;
  if (range <= 0) return "";

  const p = (v) => ((v - lo) / range * 100).toFixed(1);
  const entryLP = p(entry.lo), entryHP = p(entry.hi), t1P = p(t1);

  const gradient = isLong
    ? `linear-gradient(to right, rgba(255,94,108,.35) 0% ${entryLP}%, rgba(255,181,71,.55) ${entryLP}% ${entryHP}%, rgba(63,209,122,.3) ${entryHP}% 100%)`
    : `linear-gradient(to right, rgba(63,209,122,.3) 0% ${entryHP}%, rgba(255,181,71,.55) ${entryHP}% ${entryLP}%, rgba(255,94,108,.35) ${entryLP}% 100%)`;

  return `
    <div style="margin:16px 0 2px;">
      <div style="font-size:10px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Risk / Reward Map</div>
      <div style="position:relative;height:12px;border-radius:6px;background:${gradient};">
        <div style="position:absolute;top:0;bottom:0;left:${t1P}%;width:2px;background:rgba(255,181,71,.9);border-radius:1px;" title="T1"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:10px;">
        <span style="color:${isLong?"var(--red)":"var(--green)"};">${isLong?"Stop":"T2"} $${f2(isLong?stop:t2)}</span>
        <span style="color:var(--blue);">Entry $${f2(entry.lo)}–$${f2(entry.hi)}</span>
        <span style="color:var(--amber);">T1 $${f2(t1)}</span>
        <span style="color:${isLong?"var(--green)":"var(--red)"};">${isLong?"T2":"Stop"} $${f2(isLong?t2:stop)}</span>
      </div>
    </div>`;
}

export function renderPlan(plan, style, onUpdateSizing) {
  const body = document.getElementById("planBody");

  if (!plan || plan.direction === "flat") {
    body.innerHTML = `<div style="padding: 16px; color: var(--text-dim); font-size: 13px;">
      <strong>${plan?.name || "No setup"}</strong><br/>
      ${plan?.thesis || "No actionable setup right now. Best action: stand aside and wait for cleaner conditions."}
    </div>`;
    return;
  }

  const dir    = plan.direction === "long" ? "BUY (Long)" : "SELL SHORT";
  const dirCls = plan.direction === "long" ? "pos" : "neg";
  const t1 = plan.targets[0], t2 = plan.targets[1], t3 = plan.targets[2];
  const overallR = t2 ? t2.rMult.toFixed(1) : "—";

  body.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
      <div>
        <span class="${dirCls}" style="font-size: 16px; font-weight: 700;">${dir}</span>
        <span style="color: var(--text-dim); margin-left: 8px;">${plan.name}</span>
      </div>
      <div class="pill">${STYLE_CONFIG[style].horizon}</div>
    </div>
    <div class="plan-grid">
      <div class="plan-cell entry">
        <div class="lbl">Entry zone</div>
        <div class="val">$${f2(plan.entry.lo)} – $${f2(plan.entry.hi)}</div>
        <div style="font-size: 11px; color: var(--text-dim); margin-top: 2px;">${plan.entry.ref}</div>
      </div>
      <div class="plan-cell stop">
        <div class="lbl">Stop loss</div>
        <div class="val">$${f2(plan.stop)}</div>
        <div style="font-size: 11px; color: var(--text-dim); margin-top: 2px;">risk: $${f2(plan.stopDist)}/share (1R)</div>
      </div>
      <div class="plan-cell t1">
        <div class="lbl">Target 1 — scale out 50%</div>
        <div class="val">$${f2(t1.price)} <span style="font-size: 12px; color: var(--text-dim); font-weight: 400;">· ${t1.rMult.toFixed(1)}R</span></div>
        ${t1.profit != null ? `<div style="font-size:11px;color:var(--green);margin-top:2px;">+$${f0(t1.profit)} potential</div>` : ""}
      </div>
      <div class="plan-cell t2">
        <div class="lbl">Target 2 — primary exit</div>
        <div class="val">$${f2(t2.price)} <span style="font-size: 12px; color: var(--text-dim); font-weight: 400;">· ${t2.rMult.toFixed(1)}R</span></div>
        ${t2.profit != null ? `<div style="font-size:11px;color:var(--green);margin-top:2px;">+$${f0(t2.profit)} potential</div>` : ""}
      </div>
      ${t3 ? `<div class="plan-cell t3">
        <div class="lbl">Target 3 — runner</div>
        <div class="val">$${f2(t3.price)} <span style="font-size: 12px; color: var(--text-dim); font-weight: 400;">· ${t3.rMult.toFixed(1)}R</span></div>
        ${t3.profit != null ? `<div style="font-size:11px;color:var(--green);margin-top:2px;">+$${f0(t3.profit)} potential</div>` : ""}
      </div>` : ""}
      <div class="plan-cell size">
        <div class="lbl">Position size <span style="font-size: 11px; color: var(--text-dim);">· Grade ${plan.grade ?? "—"} (${plan.qualityMult != null ? Math.round(plan.qualityMult * 100) + "% of risk" : "full risk"})</span></div>
        <div class="val">${plan.shares} shares</div>
        <div style="font-size: 11px; color: var(--text-dim); margin-top: 2px;">$${f0(plan.dollarRisk)} risk on $${f0(plan.accountSize)} acct (${plan.riskPct}%)</div>
      </div>
    </div>
    ${rrBar(plan)}
    <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
      <span style="font-size: 12px; color: var(--text-dim);">Account: </span>
      <input id="acctInput" type="number" value="${plan.accountSize}" style="width: 100px;" />
      <span style="font-size: 12px; color: var(--text-dim);">Risk %:</span>
      <input id="riskInput" type="number" value="${plan.riskPct}" min="0.1" max="5" step="0.1" style="width: 70px;" />
      <button id="updateSizingBtn" style="font-size: 12px;">Update sizing</button>
      <span style="margin-left: auto; font-size: 12px; color: var(--text-dim);">Reward:Risk ≈ <strong style="color:var(--green);">${overallR}:1</strong></span>
    </div>
  `;

  document.getElementById("updateSizingBtn").addEventListener("click", () => {
    const acct = parseFloat(document.getElementById("acctInput").value) || 10000;
    const risk = parseFloat(document.getElementById("riskInput").value) || 1;
    onUpdateSizing(acct, risk);
  });
}

/* ================== PRE-TRADE CHECKLIST ================== */
export function renderChecklist(data, ind, setup, plan) {
  const el = document.getElementById("checklistBody");
  if (!el) return;
  if (!data || !ind || !setup || !plan || plan.direction === "flat") { el.innerHTML = ""; return; }

  const i      = data.closes.length - 1;
  const price  = data.closes[i];
  const rsi    = ind.rsi?.[i];
  const macdH  = ind.macd?.hist?.[i];
  const sma20  = ind.sma20?.[i];
  const sma50  = ind.sma50?.[i];
  const sma200 = ind.sma200?.[i];
  const vol    = data.volumes[i];
  const avgVol = data.volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volRatio = avgVol > 0 ? vol / avgVol : 1;
  const isLong = plan.direction === "long";
  const t1rr   = plan.targets[0]?.rMult ?? 0;

  const items = [];
  const chk = (label, status, note) => items.push({ label, status, note });

  // 1. Trend
  if (isLong) {
    if (sma50 && sma200 && price > sma50 && sma50 > sma200) chk("Uptrend", "pass", "price > SMA50 > SMA200");
    else if (sma50 && price > sma50)                         chk("Mixed trend", "warn", "above SMA50, SMA200 lags");
    else                                                     chk("Downtrend", "fail", "entering against trend");
  } else {
    if (sma50 && sma200 && price < sma50 && sma50 < sma200) chk("Downtrend", "pass", "price < SMA50 < SMA200");
    else if (sma50 && price < sma50)                         chk("Mixed trend", "warn", "below SMA50, SMA200 lags");
    else                                                     chk("Uptrend", "fail", "shorting into uptrend");
  }

  // 2. RSI zone
  if (rsi != null) {
    if (isLong) {
      if (rsi >= 40 && rsi <= 65)  chk("RSI clear",      "pass", rsi.toFixed(0) + " — optimal entry zone");
      else if (rsi > 65 && rsi < 75) chk("RSI elevated", "warn", rsi.toFixed(0) + " — approaching overbought");
      else if (rsi >= 75)            chk("RSI overbought","fail", rsi.toFixed(0) + " — extended, chasing");
      else                           chk("RSI weak",      "warn", rsi.toFixed(0) + " — possible downside");
    } else {
      if (rsi >= 35 && rsi <= 60)   chk("RSI clear",     "pass", rsi.toFixed(0) + " — optimal short zone");
      else if (rsi < 35 && rsi > 25) chk("RSI near oversold","warn", rsi.toFixed(0) + " — bounce risk");
      else if (rsi <= 25)            chk("RSI oversold",  "fail", rsi.toFixed(0) + " — shorting capitulation");
      else                           chk("RSI bullish",   "warn", rsi.toFixed(0) + " — momentum against short");
    }
  }

  // 3. MACD
  if (macdH != null) {
    if (isLong) {
      if (macdH > 0.05)             chk("MACD bullish", "pass", "histogram positive");
      else if (macdH > -0.05)       chk("MACD neutral", "warn", "near zero crossover");
      else                           chk("MACD bearish", "fail", "histogram negative");
    } else {
      if (macdH < -0.05)            chk("MACD bearish", "pass", "histogram negative");
      else if (macdH < 0.05)        chk("MACD neutral", "warn", "near zero crossover");
      else                           chk("MACD bullish", "fail", "momentum against short");
    }
  }

  // 4. Volume
  if (volRatio >= 0.9)        chk("Volume confirmed", "pass", volRatio.toFixed(1) + "x average");
  else if (volRatio >= 0.65)  chk("Volume light",     "warn", volRatio.toFixed(1) + "x — low conviction");
  else                        chk("Volume thin",      "fail", volRatio.toFixed(1) + "x — avoid entry");

  // 5. SMA20 alignment
  if (sma20) {
    const above = price > sma20;
    if (isLong && above)   chk("SMA20 clear",    "pass", `above $${sma20.toFixed(2)}`);
    else if (!isLong && !above) chk("SMA20 clear","pass", `below $${sma20.toFixed(2)}`);
    else                   chk("SMA20 against",  "warn", `${isLong?"below":"above"} $${sma20.toFixed(2)}`);
  }

  // 6. Confidence score
  const sc = setup.score ?? 0;
  if (sc >= 65)      chk("High confidence", "pass", sc.toFixed(0) + "% confluence");
  else if (sc >= 50) chk("Moderate conf.",  "warn", sc.toFixed(0) + "% confluence");
  else               chk("Low confidence",  "fail", sc.toFixed(0) + "% — marginal signal");

  // 7. R/R
  if (t1rr >= 2)     chk("R/R excellent", "pass", t1rr.toFixed(1) + ":1 to T1");
  else if (t1rr >= 1.5) chk("R/R good",  "pass", t1rr.toFixed(1) + ":1 to T1");
  else if (t1rr >= 1)   chk("R/R minimum","warn", t1rr.toFixed(1) + ":1 — tight");
  else                  chk("R/R poor",   "fail", t1rr.toFixed(1) + ":1 — skip");

  const icon = { pass: "✓", warn: "◆", fail: "✗" };
  el.innerHTML = `<div class="checklist">
    ${items.map(it => `<div class="check-item ${it.status}" title="${it.note}">
      <span class="check-icon">${icon[it.status]}</span>
      <span>${it.label}</span>
    </div>`).join("")}
  </div>`;
}

/* ================== AI PLAN DISPLAY ================== */
export function renderAIPlan(text) {
  const el = document.getElementById("aiPlanBody");
  if (!el) return;
  if (!text) { el.innerHTML = ""; return; }

  // Parse **SECTION** — content blocks
  const parts = text.split(/\*\*([A-Z ]+)\*\*\s*(?:—\s*)?/);
  const sections = {};
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i]?.trim();
    const val = (parts[i + 1] || "").trim().replace(/\n+$/, "");
    if (key && val) sections[key] = val;
  }

  if (!Object.keys(sections).length) {
    el.innerHTML = `<div style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap;">${text}</div>`;
    return;
  }

  const sec = (key, extraCls = "") => {
    const body = sections[key];
    if (!body) return "";
    return `<div class="ai-plan-section ${extraCls}">
      <div class="ai-plan-label">${key}</div>
      <div class="ai-plan-text">${body}</div>
    </div>`;
  };

  el.innerHTML = `<div class="ai-plan-grid">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      ${sec("ENTRY")}${sec("STOP")}
    </div>
    ${sec("TARGETS")}
    ${sec("MANAGEMENT")}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      ${sec("BULL CASE","ai-plan-bull")}${sec("BEAR CASE","ai-plan-bear")}
    </div>
    ${sec("VERDICT","ai-plan-verdict")}
  </div>`;
}

/* ================== KEY LEVELS PANEL ================== */
export function renderLevels(d, ind, symbol) {
  const i = d.closes.length - 1;
  const price = d.closes[i];
  const fb = ind.fib;
  const vwapVal = ind.vwap ? ind.vwap[i] : null;
  const pd = ind.prevDay;

  const items = [
    ["20-period MA", ind.sma20[i]],
    ["50-period MA", ind.sma50[i]],
    ["200-period MA", ind.sma200[i]],
    ["BB upper", ind.bb.upper[i]],
    ["BB lower", ind.bb.lower[i]],
    ["VWAP", vwapVal],
    pd?.pdh != null ? ["Prev Day High", pd.pdh] : null,
    pd?.pdl != null ? ["Prev Day Low",  pd.pdl] : null,
    pd?.pdc != null ? ["Prev Day Close", pd.pdc] : null,
    ["Recent high", ind.recentHigh],
    ["Recent low", ind.recentLow],
    ["Fib 23.6%", fb.f236],
    ["Fib 38.2%", fb.f382],
    ["Fib 50%", fb.f500],
    ["Fib 61.8%", fb.f618],
    ["Fib 78.6%", fb.f786],
    ...(ind.equalLevels?.equalHighs?.slice(0, 2).map((g) => [`Equal Highs (${g.indices.length}×)`, g.p]) ?? []),
    ...(ind.equalLevels?.equalLows?.slice(0, 2).map((g)  => [`Equal Lows (${g.indices.length}×)`, g.p])  ?? []),
  ].filter(Boolean).filter((x) => x[1] != null);

  // FVG/OB zones — only show the 2 closest to price (avoids DOM clutter on volatile tickers)
  const withinPct = (top, bot, pct = 0.05) => Math.abs(((top + bot) / 2 - price) / price) < pct;
  const fvgBull = (ind.fvgs?.bullish ?? []).filter((f) => withinPct(f.top, f.bot)).slice(-2);
  const fvgBear = (ind.fvgs?.bearish ?? []).filter((f) => withinPct(f.top, f.bot)).slice(-2);
  const obBull  = (ind.orderBlocks?.bullish ?? []).filter((ob) => withinPct(ob.top, ob.bot)).slice(-2);
  const obBear  = (ind.orderBlocks?.bearish ?? []).filter((ob) => withinPct(ob.top, ob.bot)).slice(-2);

  const fmtZone = (label, top, bot, colorVar) => {
    const mid = (top + bot) / 2;
    const dist = ((mid - price) / price) * 100;
    return `<div class="level"><div class="l1" style="color:var(${colorVar})">${label}</div><div class="l2">$${f2(bot)}–$${f2(top)} <span style="color:var(--text-faint); font-weight:400;">${fpct(dist)}</span></div></div>`;
  };

  const zoneHtml = [
    ...fvgBull.map((f) => fmtZone("Bullish FVG",  f.top, f.bot, "--green")),
    ...fvgBear.map((f) => fmtZone("Bearish FVG",  f.top, f.bot, "--red")),
    ...obBull.map((ob) => fmtZone("Bull OB",  ob.top, ob.bot, "--green")),
    ...obBear.map((ob) => fmtZone("Bear OB",  ob.top, ob.bot, "--red")),
  ].join("");

  document.getElementById("levelsBody").innerHTML = `
    <div style="font-size: 13px; margin-bottom: 8px; color: var(--text-dim);">
      Key technical levels for ${symbol} (sorted by price):
    </div>
    <div class="levels-row">
      ${items.sort((a, b) => b[1] - a[1]).map(([lbl, v]) => {
        const dist = ((v - price) / price) * 100;
        const colorCls = Math.abs(dist) < 1 ? "pos" : "";
        return `<div class="level"><div class="l1">${lbl}</div><div class="l2 ${colorCls}">$${f2(v)} <span style="color:var(--text-faint); font-weight: 400;">${fpct(dist)}</span></div></div>`;
      }).join("")}
      ${zoneHtml}
    </div>
  `;
}

/* ================== DETAILED REPORT ================== */
export function renderReport(d, ind, setups, plan, style) {
  const i = d.closes.length - 1;
  const price = d.closes[i];
  const r = ind.rsi[i], a = ind.atr[i];
  const sma50 = ind.sma50[i], sma200 = ind.sma200[i];
  const histNow = ind.macd.hist[i], histPrev = ind.macd.hist[i - 1];

  const trendDesc =
    sma50 && sma200
      ? price > sma50 && sma50 > sma200 ? "a clean uptrend" :
        price < sma50 && sma50 < sma200 ? "a clean downtrend" :
        price > sma50 ? "a recovering trend" : "a weakening trend"
      : "an unclear trend";

  const momoDesc =
    r == null ? "" :
    r > 70 ? "overbought (extension risk)" :
    r < 30 ? "oversold (snapback potential)" :
    r > 55 ? "bullish but not stretched" :
    r < 45 ? "bearish but not stretched" : "neutral";

  const macdDesc =
    histNow != null && histPrev != null
      ? histNow > 0 && histNow > histPrev ? "expanding bullish momentum" :
        histNow > 0 ? "bullish but slowing" :
        histNow < 0 && histNow < histPrev ? "expanding bearish momentum" :
        "bearish but slowing"
      : "ambiguous momentum";

  const top = setups[0];
  const alt = setups[1];

  const recH = ind.recentHigh, recL = ind.recentLow;
  const distHigh = ((recH - price) / price * 100).toFixed(1);
  const distLow = ((price - recL) / price * 100).toFixed(1);

  document.getElementById("report").innerHTML = `
    <h4>Trend & Structure</h4>
    <p>${d.meta.symbol} is in <strong>${trendDesc}</strong> on the ${style === "day" ? "intraday" : style === "swing" ? "daily" : "weekly"} chart.
    Price is currently ${f2(price)}, ${(price > (sma50 || 0)) ? "above" : "below"} the 50-period MA (${f2(sma50)})${sma200 ? " and " + ((price > sma200) ? "above" : "below") + " the 200-period MA (" + f2(sma200) + ")" : ""}.
    The 20-day high sits at $${f2(recH)} (${distHigh}% above) and the recent low at $${f2(recL)} (${distLow}% below) — these are the levels other traders are watching.</p>

    <h4>Momentum</h4>
    <p>RSI(14) reads <strong>${r ? r.toFixed(1) : "—"}</strong> — ${momoDesc}. MACD histogram shows <strong>${macdDesc}</strong>.
    Together these say momentum is ${histNow > 0 && r > 50 ? "aligned to the upside" : histNow < 0 && r < 50 ? "aligned to the downside" : "in conflict — a yellow flag"}.</p>

    <h4>Volatility</h4>
    <p>14-period ATR is $${f2(a)} (${a ? ((a / price) * 100).toFixed(1) : "—"}% of price). For a ${STYLE_CONFIG[style].label.toLowerCase()},
    a sensible stop is roughly ${STYLE_CONFIG[style].atrMult}× ATR ≈ $${a ? f2(a * STYLE_CONFIG[style].atrMult) : "—"} away from entry.
    ${a && (a / price) * 100 > 4 ? "Volatility is elevated — size down or expect more noise." :
      a && (a / price) * 100 < 1.5 ? "Volatility is compressed — watch for expansion." :
      "Volatility is in a normal range."}</p>

    <h4>Best-Match Setup: ${top.name}</h4>
    <p>${top.thesis}</p>
    <p><strong>Confluence (${Math.round(top.score)}%):</strong> ${(top.signals || []).join(" · ")}</p>

    ${alt && alt.score > 40 ? `<h4>Alternate Read: ${alt.name}</h4><p>${alt.thesis} <em>(${Math.round(alt.score)}% confluence)</em></p>` : ""}

    <h4>What to Do</h4>
    ${plan && plan.direction !== "flat" ? `
    <ul>
      <li><strong>Action:</strong> ${plan.direction === "long" ? "Buy" : "Sell short"} between $${f2(plan.entry.lo)} and $${f2(plan.entry.hi)} (${plan.entry.ref}).</li>
      <li><strong>Invalidation:</strong> Cut the trade if price ${plan.direction === "long" ? "closes below" : "closes above"} $${f2(plan.stop)} — that's ~$${f2(plan.stopDist)}/share of risk (1R).</li>
      <li><strong>Take profit:</strong> Scale out at $${f2(plan.targets[0].price)} (${plan.targets[0].rMult.toFixed(1)}R), $${f2(plan.targets[1].price)} (${plan.targets[1].rMult.toFixed(1)}R)${plan.targets[2] ? `, and let a runner go to $${f2(plan.targets[2].price)} (${plan.targets[2].rMult.toFixed(1)}R)` : ""}.</li>
      <li><strong>Sizing:</strong> ${plan.shares} shares (assuming $${f0(plan.accountSize)} account, ${plan.riskPct}% risk = $${f0(plan.dollarRisk)}).</li>
      <li><strong>Hold time:</strong> ${STYLE_CONFIG[style].horizon}. If the trade hasn't progressed within that window, reassess.</li>
    </ul>
    ` : `<p>Stand aside. There's no high-confluence setup that fits a ${STYLE_CONFIG[style].label.toLowerCase()}'s edge right now.</p>`}

    <h4>Risk Factors</h4>
    <ul>
      <li>Earnings, Fed meetings, and macro headlines can invalidate technical setups instantly. Check the calendar before entering.</li>
      <li>This analysis uses delayed price data and pattern heuristics — it doesn't know about news, fundamentals, or your tax situation.</li>
      <li>Backtest assumptions, never risk more than you can afford to lose, and treat every trade as one of many.</li>
    </ul>
  `;
}

/* ================== OPTIONS FLOW PANEL ================== */
export function renderOptionsFlow(flow) {
  const el = document.getElementById("panel-options");
  if (!el) return;

  if (!flow) {
    el.innerHTML = `<div style="padding:16px;color:var(--text-dim);font-size:13px;">No options data — market may be closed or symbol unsupported.</div>`;
    return;
  }

  const fmt$ = (n) =>
    n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` :
    n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` :
    `$${n.toFixed(0)}`;

  const pct = (v) => v != null ? (v * 100).toFixed(1) + "%" : "—";

  const optRow = (o) => `
    <div class="opt-row">
      <span class="opt-type ${o.type === "call" ? "pos" : "neg"}">${o.type === "call" ? "CALL" : "PUT"}</span>
      <span class="opt-strike">$${o.strike}</span>
      <span class="opt-exp">${new Date(o.expiration * 1000).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
      <span>$${f2(o.lastPrice)}</span>
      <span>${(o.volume || 0).toLocaleString()}</span>
      <span style="color:var(--text-dim)">${(o.openInterest || 0).toLocaleString()}</span>
      <span style="color:var(--text-dim)">${pct(o.impliedVolatility)}</span>
      <span class="${o.type === "call" ? "pos" : "neg"}" style="font-weight:600;">${fmt$(o.premium)}</span>
    </div>`;

  const headerRow = `
    <div class="opt-row opt-row-header">
      <span>Type</span><span>Strike</span><span>Exp</span><span>Last</span>
      <span>Volume</span><span>OI</span><span>IV</span><span>Premium</span>
    </div>`;

  const netFlow = flow.netFlow;
  const netCls  = netFlow >= 0 ? "pos" : "neg";

  el.innerHTML = `
    <div class="opt-summary">
      <div class="opt-stat"><div class="lbl">P/C Vol</div><div class="val ${flow.sentimentCls}">${flow.pcVolRatio != null ? flow.pcVolRatio.toFixed(2) : "—"}</div></div>
      <div class="opt-stat"><div class="lbl">P/C OI</div><div class="val">${flow.pcOIRatio != null ? flow.pcOIRatio.toFixed(2) : "—"}</div></div>
      <div class="opt-stat"><div class="lbl">ATM IV</div><div class="val">${pct(flow.atmIV)}</div></div>
      <div class="opt-stat"><div class="lbl">Call $</div><div class="val pos">${fmt$(flow.callPremium)}</div></div>
      <div class="opt-stat"><div class="lbl">Put $</div><div class="val neg">${fmt$(flow.putPremium)}</div></div>
      <div class="opt-stat"><div class="lbl">Net Flow</div><div class="val ${netCls}">${netFlow >= 0 ? "+" : ""}${fmt$(netFlow)}</div></div>
      <div class="opt-stat"><div class="lbl">Sentiment</div><div class="val ${flow.sentimentCls}">${flow.sentiment}</div></div>
    </div>

    ${flow.unusual.length ? `
      <div class="opt-section-label" style="color:var(--amber);">⚡ Unusual Activity — Vol ≥ OI</div>
      ${headerRow}
      ${flow.unusual.map(optRow).join("")}
    ` : ""}

    <div class="opt-section-label" style="color:var(--green);">▲ Top Calls by Premium</div>
    ${headerRow}
    ${flow.topCalls.length ? flow.topCalls.map(optRow).join("") : `<div class="opt-empty">No call volume</div>`}

    <div class="opt-section-label" style="color:var(--red);">▼ Top Puts by Premium</div>
    ${headerRow}
    ${flow.topPuts.length ? flow.topPuts.map(optRow).join("") : `<div class="opt-empty">No put volume</div>`}

    <div style="font-size:11px;color:var(--text-faint);margin-top:10px;padding-top:8px;border-top:1px solid var(--border);">
      Exp: ${flow.expDate} · ${flow.expirationDates.length} expirations available · ~15-min delayed
    </div>
  `;
}

/* ================== CALCULATORS ================== */

let _lastPlan   = null;
let _plTargets  = [];   // array of exit prices (numbers)

export function renderCalculators(plan) {
  const card = document.getElementById("calcCard");
  if (!card) return;
  card.style.display = "";
  _lastPlan = plan;

  // Always reset inputs from plan on each analyze()
  if (plan && plan.direction !== "flat") {
    _set("cAcct",    plan.accountSize);
    _set("cRisk",    plan.riskPct);
    _set("cEntry",   f2(plan.entry.hi));
    _set("cStop",    f2(plan.stop));
    _set("cShares",  plan.shares);
    _set("cPLEntry", f2(plan.entry.hi));
    _plTargets = plan.targets.map(t => t.price);
  } else {
    if (_plTargets.length === 0) _plTargets = [0, 0, 0];
  }

  _renderTargetRows();
  _wireCalcEvents();
  _recalcSizer();
  _recalcPL();
}

function _set(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = (val != null ? val : "");
}

function _wireCalcEvents() {
  ["cAcct", "cRisk", "cEntry", "cStop"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = () => { _recalcSizer(); _recalcPL(); };
  });
  ["cShares", "cPLEntry"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = _recalcPL;
  });
  const addBtn = document.getElementById("cAddTarget");
  if (addBtn) addBtn.onclick = () => { _plTargets.push(0); _renderTargetRows(); _recalcPL(); };

  const resetBtn = document.getElementById("calcResetBtn");
  if (resetBtn) resetBtn.onclick = () => renderCalculators(_lastPlan);
}

function _renderTargetRows() {
  const container = document.getElementById("cTargetRows");
  if (!container) return;

  const header = `
    <div class="calc-trow calc-trow-hdr">
      <span></span><span>Exit ($)</span>
      <span>P&amp;L</span><span>Return</span><span>R</span>
    </div>`;

  const rows = _plTargets.map((price, i) => `
    <div class="calc-trow">
      <span class="calc-tlbl">T${i + 1}</span>
      <input class="calc-texit" type="number" step="0.01" placeholder="0.00"
             value="${price > 0 ? f2(price) : ""}" data-ti="${i}" />
      <span id="cTPnl${i}">—</span>
      <span id="cTPct${i}">—</span>
      <span id="cTR${i}" style="color:var(--text-dim)">—</span>
    </div>`).join("");

  container.innerHTML = header + rows;

  container.querySelectorAll(".calc-texit").forEach(inp => {
    inp.oninput = () => {
      _plTargets[+inp.dataset.ti] = parseFloat(inp.value) || 0;
      _recalcPL();
    };
  });
}

function _recalcSizer() {
  const out = document.getElementById("cSizerOut");
  if (!out) return;

  const acct  = +document.getElementById("cAcct")?.value  || 0;
  const risk  = +document.getElementById("cRisk")?.value  || 0;
  const entry = +document.getElementById("cEntry")?.value || 0;
  const stop  = +document.getElementById("cStop")?.value  || 0;

  if (!acct || !risk || !entry || !stop || Math.abs(entry - stop) < 0.0001) {
    out.innerHTML = `<div class="calc-hint">Fill all fields to calculate.</div>`;
    return;
  }

  const dollarRisk = acct * (risk / 100);
  const stopDist   = Math.abs(entry - stop);
  const shares     = Math.floor(dollarRisk / stopDist);
  const posValue   = shares * entry;

  out.innerHTML = `
    <div class="calc-result-row">
      <span>Dollar risk</span>
      <span class="neg">–$${f0(dollarRisk)}</span>
    </div>
    <div class="calc-result-row">
      <span>Stop distance</span>
      <span>$${f2(stopDist)} <em class="calc-dim">(${((stopDist/entry)*100).toFixed(1)}%)</em></span>
    </div>
    <div class="calc-result-row calc-result-hi">
      <span>Shares to buy</span>
      <span>${shares.toLocaleString()}</span>
    </div>
    <div class="calc-result-row">
      <span>Position value</span>
      <span>$${f0(posValue)} <em class="calc-dim">(${((posValue/acct)*100).toFixed(1)}% of acct)</em></span>
    </div>`;
}

function _recalcPL() {
  const shares   = +document.getElementById("cShares")?.value  || 0;
  const entry    = +document.getElementById("cPLEntry")?.value || 0;
  const stop     = +document.getElementById("cStop")?.value    || 0;
  const stopDist = (stop && entry) ? Math.abs(entry - stop) : 0;

  _plTargets.forEach((exitPrice, i) => {
    const pnlEl = document.getElementById(`cTPnl${i}`);
    const pctEl = document.getElementById(`cTPct${i}`);
    const rEl   = document.getElementById(`cTR${i}`);
    if (!pnlEl) return;

    if (!shares || !entry || !exitPrice) {
      pnlEl.textContent = "—";
      if (pctEl) pctEl.textContent = "—";
      if (rEl)   rEl.textContent   = "—";
      return;
    }

    const pnl = (exitPrice - entry) * shares;
    const pct = ((exitPrice - entry) / entry) * 100;
    const r   = stopDist > 0 ? Math.abs(exitPrice - entry) / stopDist : null;
    const cls = pnl >= 0 ? "pos" : "neg";

    pnlEl.innerHTML = `<span class="${cls}">${pnl >= 0 ? "+" : "–"}$${f0(Math.abs(pnl))}</span>`;
    if (pctEl) pctEl.innerHTML = `<span class="${cls}">${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</span>`;
    if (rEl)   rEl.textContent = r != null ? r.toFixed(1) + "R" : "—";
  });
}

/* ================== NEWS PANEL ================== */
export function renderNews(data) {
  const el = document.getElementById("panel-news");
  if (!el) return;

  if (!data) {
    el.innerHTML = `<div class="news-empty">No news available.</div>`;
    return;
  }

  const { articles = [], events = {} } = data;

  const timeAgo = (ts) => {
    if (!ts) return "";
    const s = Math.floor(Date.now() / 1000 - ts);
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  const eventPills = [
    events.earningsDate   ? `<span class="news-event-pill amber">Earnings ${events.earningsDate}</span>` : "",
    events.dividendDate   ? `<span class="news-event-pill blue">Dividend ${events.dividendDate}</span>` : "",
    events.exDividendDate ? `<span class="news-event-pill">Ex-Div ${events.exDividendDate}</span>` : "",
  ].filter(Boolean).join("");

  const eventsHtml = eventPills
    ? `<div class="news-events">${eventPills}</div>`
    : "";

  const articlesHtml = articles.length
    ? articles.map(a => `
      <a class="news-item" href="${a.link}" target="_blank" rel="noopener noreferrer">
        <div class="news-meta">
          <span class="news-tag ${a.tag === "MARKET" ? "market" : "stock"}">${a.tag}</span>
          <span class="news-pub">${a.publisher}</span>
          <span class="news-time">${timeAgo(a.publishedAt)}</span>
        </div>
        <div class="news-title">${a.title}</div>
      </a>`).join("")
    : `<div class="news-empty">No recent news found.</div>`;

  el.innerHTML = eventsHtml + `<div class="news-list">${articlesHtml}</div>`;
}

/* ================== EXECUTION PANEL ================== */
export function renderExecution(plan, symbol, style) {
  const broker = document.getElementById("brokerSelect").value;
  const body = document.getElementById("executeBody");

  if (!plan || plan.direction === "flat") {
    body.innerHTML = `<div style="color: var(--text-dim); font-size: 13px;">No actionable setup — nothing to execute.</div>`;
    return;
  }

  const action = plan.direction === "long" ? "BUY" : "SELL SHORT";
  const limitPrice = plan.entry.hi;
  const isBreakout = plan.key === "breakout_long";
  const orderType = isBreakout ? "Stop Limit" : "Limit";
  const tif = style === "day" ? "DAY" : "GTC";

  const ticket = `
<div class="ticket">
<span class="k">Symbol:</span>     <span class="v">${symbol}</span>
<span class="k">Action:</span>     <span class="v">${action}</span>
<span class="k">Order type:</span> <span class="v">${orderType}</span>
<span class="k">Quantity:</span>   <span class="v">${plan.shares} shares</span>
<span class="k">${isBreakout ? "Stop trigger:" : "Limit price:"}</span> <span class="v">$${f2(isBreakout ? plan.entry.lo : limitPrice)}</span>${isBreakout ? `\n<span class="k">Limit price:</span>  <span class="v">$${f2(limitPrice)}</span>` : ""}
<span class="k">Time-in-force:</span> <span class="v">${tif}</span>

<span class="k">--- Bracket / OCO ---</span>
<span class="k">Stop loss:</span>   <span class="v">$${f2(plan.stop)} (Stop Market)</span>
<span class="k">Target 1:</span>    <span class="v">$${f2(plan.targets[0].price)} · ${Math.floor(plan.shares / 3)} sh</span>
<span class="k">Target 2:</span>    <span class="v">$${f2(plan.targets[1].price)} · ${Math.floor(plan.shares / 3)} sh</span>
${plan.targets[2] ? `<span class="k">Target 3:</span>    <span class="v">$${f2(plan.targets[2].price)} · ${plan.shares - 2 * Math.floor(plan.shares / 3)} sh (runner)</span>` : ""}
</div>`;

  const steps = brokerSteps(broker, plan, action, orderType, limitPrice, isBreakout, symbol, style);

  body.innerHTML = `
    <div style="margin-bottom: 12px;">
      <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 6px;">📋 Generic order ticket</div>
      ${ticket}
    </div>
    <div>
      <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 6px;">🎯 Step-by-step on ${brokerLabel(broker)}</div>
      ${steps}
    </div>
  `;
}

/* ================== BACKTEST ================== */
export function renderBacktest(result, setupName) {
  const el = document.getElementById("panel-backtest");
  if (!el) return;

  if (!result) {
    el.innerHTML = `<div class="loading">Not enough data to backtest.</div>`;
    return;
  }

  if (result.occurrences === 0) {
    el.innerHTML = `<div class="loading">No historical occurrences of <strong>${setupName}</strong> found in the last 150 bars.</div>`;
    return;
  }

  const wrCls = result.winRate >= 50 ? "bull" : "bear";
  const rCls  = result.avgR    >= 0  ? "bull" : "bear";

  el.innerHTML = `
    <div class="bt-header">
      <span style="font-size:13px; color:var(--text-dim);">Pattern: <strong style="color:var(--text);">${setupName}</strong></span>
      <span style="font-size:11px; color:var(--text-faint);">Last 150 bars · 2R target · 1R stop · 15-bar window</span>
    </div>
    <div class="bt-stats">
      <div class="bt-stat"><div class="bt-stat-lbl">Occurrences</div><div class="bt-stat-val">${result.occurrences}</div></div>
      <div class="bt-stat"><div class="bt-stat-lbl">Wins</div><div class="bt-stat-val bull">${result.wins}</div></div>
      <div class="bt-stat"><div class="bt-stat-lbl">Losses</div><div class="bt-stat-val bear">${result.losses}</div></div>
      <div class="bt-stat"><div class="bt-stat-lbl">Win Rate</div><div class="bt-stat-val ${wrCls}">${result.winRate.toFixed(0)}%</div></div>
      <div class="bt-stat"><div class="bt-stat-lbl">Avg R</div><div class="bt-stat-val ${rCls}">${result.avgR >= 0 ? "+" : ""}${result.avgR.toFixed(2)}R</div></div>
    </div>
    <div style="font-size:11px; color:var(--text-faint); margin-top:10px;">
      Heuristic pattern-matching on historical bars — not a real backtest. Educational only.
    </div>`;
}
