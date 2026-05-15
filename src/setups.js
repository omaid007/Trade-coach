import { STYLE_CONFIG } from "./config.js";

/**
 * Score and rank candidate trade setups for the current bar.
 *
 * Returns setups sorted by `score` (highest first). Each setup has the shape:
 *   { key, name, direction: "long"|"short"|"flat", score, entry: {lo, hi, ref},
 *     stop, targets: number[], thesis, signals: string[] }
 */
export function detectSetups(d, ind, style) {
  const i = d.closes.length - 1;
  const price  = d.closes[i];
  const sma20  = ind.sma20[i];
  const sma50  = ind.sma50[i];
  const sma200 = ind.sma200[i];
  const r      = ind.rsi[i] ?? 50;
  const histNow  = ind.macd.hist[i]     ?? 0;
  const histPrev = ind.macd.hist[i - 1] ?? 0;
  const macdLine = ind.macd.macd[i]     ?? 0;
  const sigLine  = ind.macd.signal[i]   ?? 0;
  const a    = ind.atr[i] ?? price * 0.02;
  const bbU  = ind.bb.upper[i];
  const bbL  = ind.bb.lower[i];
  const bbM  = ind.bb.mid[i];
  const recH = ind.recentHigh;
  const recL = ind.recentLow;
  const aMult = STYLE_CONFIG[style].atrMult;

  // Volume: compare current bar vs 20-bar average
  const volNow = d.volumes[i] ?? 0;
  const vol20  = d.volumes.slice(Math.max(0, i - 20), i).reduce((s, v) => s + v, 0) / Math.min(20, i) || 1;
  const volRatio = volNow / vol20;

  // ICT structure helpers
  const nearFVGBull = ind.fvgs?.bullish?.some((f) => price >= f.bot - a * 0.5 && price <= f.top + a * 0.5) ?? false;
  const nearFVGBear = ind.fvgs?.bearish?.some((f) => price <= f.top + a * 0.5 && price >= f.bot - a * 0.5) ?? false;
  const atOBBull    = ind.orderBlocks?.bullish?.some((ob) => price >= ob.bot && price <= ob.top + a) ?? false;
  const atOBBear    = ind.orderBlocks?.bearish?.some((ob) => price <= ob.top && price >= ob.bot - a) ?? false;
  const divType     = ind.rsiDiv?.type;
  const divBull     = divType === "bullish" || divType === "hidden_bull";
  const divBear     = divType === "bearish" || divType === "hidden_bear";
  const eqHigh      = ind.equalLevels?.equalHighs?.some((g) => Math.abs(g.p - recH) < a) ?? false;
  const eqLow       = ind.equalLevels?.equalLows?.some((g) => Math.abs(g.p - recL) < a) ?? false;

  // Bollinger Band position: 0 = at lower, 0.5 = mid, 1 = at upper
  const bbRange = (bbU && bbL) ? bbU - bbL : null;
  const bbPos   = bbRange ? (price - bbL) / bbRange : 0.5; // 0–1

  // MA slope: positive = rising, negative = falling (use 3-bar look-back)
  const slope = (arr) => {
    const a = arr[i], b = arr[i - 3];
    return (a != null && b != null) ? (a - b) / b : 0;
  };
  const sma20Slope  = slope(ind.sma20);
  const sma50Slope  = slope(ind.sma50);
  const sma200Slope = slope(ind.sma200);

  const setups = [];

  // ─── helper: clamp to 0-100 ───────────────────────────────────────────────
  const clamp = (v, min = 0, max = 100) => Math.min(max, Math.max(min, v));

  /* ════════════════════════════════════════════════════════════════════════
   * 1. BULLISH TREND CONTINUATION
   * Built from 0: each factor contributes points. Max ~100.
   * ════════════════════════════════════════════════════════════════════════ */
  if (sma50 != null && sma200 != null && price > sma50 && sma50 > sma200) {
    let pts = 0;
    const sigs = [];

    // Trend alignment (max 30)
    pts += 12; sigs.push("50MA > 200MA");                          // golden cross structure
    if (sma20 && price > sma20)    { pts += 8;  sigs.push("Price > 20MA"); }
    if (sma20 && sma20 > sma50)    { pts += 5;  sigs.push("Full MA stack"); }
    if (sma200Slope > 0.001)       { pts += 5;  sigs.push("200MA rising"); }

    // Momentum: RSI (max 15)
    if      (r >= 50 && r <= 65)   { pts += 15; sigs.push(`RSI ${r.toFixed(0)} — ideal zone`); }
    else if (r >  65 && r <= 75)   { pts += 8;  sigs.push(`RSI ${r.toFixed(0)} — elevated`); }
    else if (r >= 45 && r <  50)   { pts += 5;  sigs.push(`RSI ${r.toFixed(0)} — just below mid`); }
    else if (r >  75)              { pts -= 5;  sigs.push(`RSI ${r.toFixed(0)} — overbought`); }
    else                           { pts -= 8;  sigs.push(`RSI ${r.toFixed(0)} — weak`); }

    // MACD (max 13)
    if (macdLine > sigLine)        { pts += 8;  sigs.push("MACD above signal"); }
    if (histNow > 0 && histNow > histPrev) { pts += 5; sigs.push("MACD momentum expanding"); }
    else if (histNow > 0)          { pts += 3;  }

    // ICT structure (max 22)
    if (nearFVGBull) { pts += 10; sigs.push("Bullish FVG"); }
    if (atOBBull)    { pts += 8;  sigs.push("At Bull Order Block"); }
    if (divBull)     { pts += 12; sigs.push(ind.rsiDiv.description); }

    // Volume confirmation (max 8)
    if      (volRatio > 1.5) { pts += 8; sigs.push("Volume surge"); }
    else if (volRatio > 1.1) { pts += 4; sigs.push("Above-avg volume"); }

    // Deductions for conflicting signals
    if (bbPos > 0.85) pts -= 8;   // near top of BB = stretched
    if (r > 80)       pts -= 10;  // extreme overbought
    if (histNow < histPrev && histNow < 0) pts -= 5;

    const score = clamp(pts);
    setups.push({
      key: "trend_long",
      name: "Bullish Trend Continuation",
      direction: "long",
      score,
      entry: {
        lo: sma20 ? sma20 * 0.998 : price * 0.985,
        hi: sma20 ? sma20 * 1.005 : price * 1.005,
        ref: "20-period MA pullback",
      },
      stop: Math.min(sma50, price - aMult * a),
      targets: [price + aMult * a * 1.5, recH, recH + (recH - recL) * 0.382],
      thesis:
        `Price is in an established uptrend (above 50- and 200-period MAs in the right order). ` +
        `RSI ${r.toFixed(0)} is ${r >= 50 && r <= 65 ? "in the ideal zone" : "constructive"}. Buy a pullback toward ` +
        `the 20-period MA — bulls typically defend that line in healthy trends.`,
      signals: sigs,
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 2. BEARISH TREND CONTINUATION
   * ════════════════════════════════════════════════════════════════════════ */
  if (sma50 != null && sma200 != null && price < sma50 && sma50 < sma200) {
    let pts = 0;
    const sigs = [];

    // Trend alignment (max 30)
    pts += 12; sigs.push("50MA < 200MA");
    if (sma20 && price < sma20)    { pts += 8;  sigs.push("Price < 20MA"); }
    if (sma20 && sma20 < sma50)    { pts += 5;  sigs.push("Full bear MA stack"); }
    if (sma200Slope < -0.001)      { pts += 5;  sigs.push("200MA falling"); }

    // Momentum: RSI (max 15)
    if      (r >= 35 && r <= 50)   { pts += 15; sigs.push(`RSI ${r.toFixed(0)} — ideal zone`); }
    else if (r >= 25 && r <  35)   { pts += 8;  sigs.push(`RSI ${r.toFixed(0)} — oversold`); }
    else if (r >  50 && r <= 55)   { pts += 5;  sigs.push(`RSI ${r.toFixed(0)} — just above mid`); }
    else if (r <  25)              { pts -= 5;  sigs.push(`RSI ${r.toFixed(0)} — extreme oversold`); }
    else                           { pts -= 8;  sigs.push(`RSI ${r.toFixed(0)} — strong`); }

    // MACD (max 13)
    if (macdLine < sigLine)        { pts += 8;  sigs.push("MACD below signal"); }
    if (histNow < 0 && histNow < histPrev) { pts += 5; sigs.push("MACD momentum expanding bearish"); }
    else if (histNow < 0)          { pts += 3; }

    // ICT structure (max 22)
    if (nearFVGBear) { pts += 10; sigs.push("Bearish FVG"); }
    if (atOBBear)    { pts += 8;  sigs.push("At Bear Order Block"); }
    if (divBear)     { pts += 12; sigs.push(ind.rsiDiv.description); }

    // Volume confirmation (max 8)
    if      (volRatio > 1.5) { pts += 8; sigs.push("Volume surge"); }
    else if (volRatio > 1.1) { pts += 4; sigs.push("Above-avg volume"); }

    // Deductions
    if (bbPos < 0.15) pts -= 8;   // near bottom of BB = stretched short
    if (r < 20)       pts -= 10;  // extreme oversold

    const score = clamp(pts);
    setups.push({
      key: "trend_short",
      name: "Bearish Trend Continuation",
      direction: "short",
      score,
      entry: {
        lo: sma20 ? sma20 * 0.995 : price * 0.995,
        hi: sma20 ? sma20 * 1.002 : price * 1.015,
        ref: "20-period MA rally",
      },
      stop: Math.max(sma50, price + aMult * a),
      targets: [price - aMult * a * 1.5, recL, recL - (recH - recL) * 0.382],
      thesis:
        `Downtrend in force (price < 50MA < 200MA). Fade rallies into the 20-period MA — ` +
        `sellers typically reload there. RSI ${r.toFixed(0)} confirms bearish momentum.`,
      signals: sigs,
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 3. BREAKOUT LONG
   * ════════════════════════════════════════════════════════════════════════ */
  const distToHigh = (recH - price) / price;
  if (distToHigh < 0.015 && distToHigh > -0.01 && r > 50) {
    let pts = 0;
    const sigs = [];

    pts += 18; sigs.push("At 20-bar high");   // proximity to breakout level

    // Momentum
    if (r > 55 && r < 80) { pts += 12; sigs.push(`RSI ${r.toFixed(0)} — momentum`); }
    else if (r >= 80)     { pts += 5;  sigs.push(`RSI ${r.toFixed(0)} — hot`); }

    if (histNow > histPrev && histNow > 0) { pts += 10; sigs.push("MACD expanding"); }
    else if (histNow > 0)                  { pts += 5; }

    // Trend support
    if (sma50 && price > sma50)   { pts += 10; sigs.push("Above 50MA"); }
    if (sma200 && price > sma200) { pts += 5;  sigs.push("Above 200MA"); }

    // ICT
    if (eqHigh)      { pts += 10; sigs.push("Equal Highs — liquidity above"); }
    if (nearFVGBull) { pts += 8;  sigs.push("Bullish FVG support"); }
    if (atOBBull)    { pts += 6;  sigs.push("At Bull Order Block"); }

    // Volume surge matters most for breakouts
    if      (volRatio > 2.0) { pts += 12; sigs.push("Strong volume breakout"); }
    else if (volRatio > 1.3) { pts += 7;  sigs.push("Volume confirmation"); }
    else                     { pts -= 8;  sigs.push("Low volume — caution"); }

    // Deductions
    if (r > 80)       pts -= 10;
    if (sma50 && price < sma50) pts -= 10;

    const score = clamp(pts);
    setups.push({
      key: "breakout_long",
      name: "Breakout Long",
      direction: "long",
      score,
      entry: { lo: recH, hi: recH * 1.005, ref: "above 20-period high" },
      stop: recH - aMult * a,
      targets: [recH + aMult * a, recH + aMult * a * 2, recH + aMult * a * 3],
      thesis:
        `Price is coiled at the recent high${eqHigh ? " with equal highs — a liquidity target above" : ""}. ` +
        `A clean break with${volRatio > 1.3 ? " volume confirmation" : " caution (low volume)"} often runs ` +
        `another ATR or two as shorts cover. Use a stop-limit BUY just above the high.`,
      signals: sigs,
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 4. OVERSOLD MEAN-REVERSION LONG
   * ════════════════════════════════════════════════════════════════════════ */
  if (r < 35 && bbL && price <= bbL * 1.01) {
    let pts = 0;
    const sigs = [];

    // Core conditions
    if (r < 25)      { pts += 22; sigs.push(`RSI ${r.toFixed(0)} — extreme oversold`); }
    else             { pts += 14; sigs.push(`RSI ${r.toFixed(0)} — oversold`); }

    if (bbPos < 0.08) { pts += 18; sigs.push("At/below lower BB"); }
    else              { pts += 10; sigs.push("Near lower BB"); }

    // Structural support
    if (sma200 && price > sma200) { pts += 10; sigs.push("Above 200MA — structure bullish"); }
    if (nearFVGBull)              { pts += 12; sigs.push("Bullish FVG"); }
    if (atOBBull)                 { pts += 10; sigs.push("At Bull Order Block"); }
    if (divBull)                  { pts += 15; sigs.push(ind.rsiDiv.description); }
    if (eqLow)                    { pts += 8;  sigs.push("Equal Lows — liquidity swept"); }

    // Volume: capitulation spike is bullish for mean-reversion
    if (volRatio > 1.5) { pts += 8; sigs.push("Volume spike — possible capitulation"); }

    // Deductions: strong downtrend makes MR dangerous
    if (sma50 && price < sma50 * 0.97) pts -= 8;
    if (!divBull && r < 20)            pts -= 5;  // extreme but no divergence = knife-catch

    const score = clamp(pts);
    setups.push({
      key: "oversold_long",
      name: "Oversold Bounce (Mean Reversion)",
      direction: "long",
      score,
      entry: { lo: price * 0.995, hi: price * 1.005, ref: "current price (limit)" },
      stop: price - 1.2 * a,
      targets: [bbM, sma20 || bbM, bbU],
      thesis:
        `RSI ${r.toFixed(0)} is oversold with price tagging the lower Bollinger Band. ` +
        `${divBull ? "Bullish divergence adds conviction. " : ""}` +
        `Mean-reversion bounces target the mid-band first. Keep the stop tight — ` +
        `mean reversion fails fast in real downtrends.`,
      signals: sigs,
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 5. OVERBOUGHT MEAN-REVERSION SHORT
   * ════════════════════════════════════════════════════════════════════════ */
  if (r > 70 && bbU && price >= bbU * 0.99) {
    let pts = 0;
    const sigs = [];

    if (r > 80)      { pts += 22; sigs.push(`RSI ${r.toFixed(0)} — extreme overbought`); }
    else             { pts += 14; sigs.push(`RSI ${r.toFixed(0)} — overbought`); }

    if (bbPos > 0.92) { pts += 18; sigs.push("At/above upper BB"); }
    else              { pts += 10; sigs.push("Near upper BB"); }

    if (sma200 && price < sma200) { pts += 10; sigs.push("Below 200MA — structure bearish"); }
    if (nearFVGBear)              { pts += 12; sigs.push("Bearish FVG"); }
    if (atOBBear)                 { pts += 10; sigs.push("At Bear Order Block"); }
    if (divBear)                  { pts += 15; sigs.push(ind.rsiDiv.description); }
    if (eqHigh)                   { pts += 8;  sigs.push("Equal Highs — liquidity swept"); }

    if (volRatio > 1.5) { pts += 8; sigs.push("Volume spike — possible exhaustion"); }

    // Deductions: strong uptrend makes overbought fades dangerous
    if (sma50 && price > sma50 * 1.03) pts -= 8;
    if (!divBear && r > 85)            pts -= 5;

    const score = clamp(pts);
    setups.push({
      key: "overbought_short",
      name: "Overbought Fade (Mean Reversion)",
      direction: "short",
      score,
      entry: { lo: price * 0.995, hi: price * 1.01, ref: "current price (limit)" },
      stop: price + 1.2 * a,
      targets: [bbM, sma20 || bbM, bbL],
      thesis:
        `RSI ${r.toFixed(0)} is overbought with price at the upper Bollinger Band. ` +
        `${divBear ? "Bearish divergence adds conviction. " : ""}` +
        `Counter-trend fades work best in ranges — use a tight stop.`,
      signals: sigs,
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 6. FALLBACK: STAND ASIDE
   * ════════════════════════════════════════════════════════════════════════ */
  if (setups.length === 0 || setups[0].score < 45) {
    setups.push({
      key: "wait",
      name: "Wait — No High-Quality Setup",
      direction: "flat",
      score: 100 - (setups[0]?.score || 0),
      entry: null,
      stop: null,
      targets: [],
      thesis:
        `Conditions are mixed. No setup hit the confluence threshold for this style. ` +
        `Best action: wait for clearer trend, a touch of a key level, or momentum confirmation.`,
      signals: ["Mixed signals", "Low confluence"],
    });
  }

  return setups.sort((a, b) => b.score - a.score);
}
