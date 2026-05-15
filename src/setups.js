import { STYLE_CONFIG } from "./config.js";

/**
 * Score and rank candidate trade setups for the current bar.
 *
 * Returns setups sorted by `score` (highest first). Each setup has the shape:
 *   { key, name, direction: "long"|"short"|"flat", score, entry: {lo, hi, ref},
 *     stop, targets: number[], thesis, signals: string[] }
 */
// Format a price for display — avoids trailing zeroes for large prices
function fp(v) {
  if (v == null) return "—";
  return v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
}

// Describe % distance from price to a level (e.g. "2.4% below the 50MA")
function dist(price, level, label) {
  if (!level) return "";
  const pct = ((price - level) / level * 100).toFixed(1);
  return `${Math.abs(pct)}% ${+pct > 0 ? "above" : "below"} the ${label}`;
}

export function detectSetups(d, ind, style) {
  const i = d.closes.length - 1;
  const price  = d.closes[i];
  const sym    = d.meta?.symbol ?? "";
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
      thesis: (() => {
        const entryLvl = sma20 ? fp(sma20) : fp(price * 0.99);
        const maStatus = macdLine > sigLine
          ? (histNow > histPrev ? "expanding bullish histogram" : "positive but slowing")
          : "crossing bearish — watch closely";
        const volNote  = volRatio > 1.3 ? ` Volume is running ${(volRatio).toFixed(1)}× average, confirming buyers.`
                       : volRatio < 0.8 ? ` Volume is light (${(volRatio).toFixed(1)}× avg) — wait for heavier buying before adding size.`
                       : "";
        const ictNote  = nearFVGBull ? ` Price is inside a bullish Fair Value Gap — ICT traders will defend this level aggressively.`
                       : atOBBull    ? ` Price is sitting on a bullish Order Block, a key institutional demand zone.`
                       : "";
        const divNote  = divBull ? ` RSI divergence (${ind.rsiDiv.description}) adds confluence — momentum is recovering before price.` : "";
        const invalidate = sma50 ? ` Setup invalidates on a daily close below the 50MA ($${fp(sma50)}).` : "";
        return `${sym} is in a confirmed uptrend: price ($${fp(price)}) is ${dist(price, sma50, "50MA")} and ${dist(price, sma200, "200MA")}, with MAs stacked in bullish order. ` +
               `RSI ${r.toFixed(0)} is ${r >= 50 && r <= 65 ? "in the ideal zone (strong but not stretched)" : r > 65 ? "elevated — partial position sizing advised" : "recovering toward 50"}; MACD shows ${maStatus}.` +
               `${volNote}${ictNote}${divNote} Target a pullback entry near the 20MA (~$${entryLvl}).${invalidate}`;
      })(),
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
      thesis: (() => {
        const entryLvl = sma20 ? fp(sma20) : fp(price * 1.01);
        const maStatus = macdLine < sigLine
          ? (histNow < histPrev ? "expanding bearish histogram" : "negative but flattening")
          : "crossing bullish — reduce size";
        const volNote  = volRatio > 1.3 ? ` Volume is ${(volRatio).toFixed(1)}× average on the decline, confirming distribution.`
                       : volRatio < 0.8 ? ` Volume is thin (${(volRatio).toFixed(1)}× avg) — be cautious, low-volume moves can reverse quickly.`
                       : "";
        const ictNote  = nearFVGBear ? ` Price is inside a bearish Fair Value Gap — ICT traders expect a rejection here.`
                       : atOBBear    ? ` Price is at a bearish Order Block, an institutional supply zone.`
                       : "";
        const divNote  = divBear ? ` RSI divergence (${ind.rsiDiv.description}) confirms momentum is deteriorating before price.` : "";
        const invalidate = sma50 ? ` Setup invalidates on a daily close back above the 50MA ($${fp(sma50)}).` : "";
        return `${sym} is in a confirmed downtrend: price ($${fp(price)}) is ${dist(price, sma50, "50MA")} and ${dist(price, sma200, "200MA")}, MAs stacked in bearish order. ` +
               `RSI ${r.toFixed(0)} is ${r >= 35 && r <= 50 ? "in the ideal short zone" : r < 35 ? "oversold — avoid new shorts, wait for a bounce" : "still elevated — better entry possible on a rally to the 20MA"}; MACD shows ${maStatus}.` +
               `${volNote}${ictNote}${divNote} Fade a rally into the 20MA (~$${entryLvl}).${invalidate}`;
      })(),
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
      thesis: (() => {
        const volDesc  = volRatio > 2.0 ? `strong volume (${(volRatio).toFixed(1)}× avg) — high-conviction break`
                       : volRatio > 1.3 ? `above-average volume (${(volRatio).toFixed(1)}× avg)`
                       : `light volume (${(volRatio).toFixed(1)}× avg) — risk of a false breakout, wait for confirmation`;
        const liqNote  = eqHigh ? ` Equal highs at $${fp(recH)} create a liquidity pool — a break will trigger stop orders and accelerate the move.` : "";
        const fvgNote  = nearFVGBull ? ` A bullish FVG below provides a demand cushion.` : "";
        const maNote   = sma50 ? ` Price is ${dist(price, sma50, "50MA")}, ${price > sma50 ? "a constructive tailwind for the breakout" : "which is a headwind — wait for reclaim first"}.` : "";
        const invalidate = ` Setup invalidates if price reverses back below $${fp(recH - a * 0.5)} on volume.`;
        return `${sym} ($${fp(price)}) is pressing against its 20-bar high at $${fp(recH)} with ${volDesc}.` +
               `${liqNote}${fvgNote}${maNote} RSI ${r.toFixed(0)} and ${macdLine > sigLine ? "positive MACD" : "MACD turning up"} support the breakout thesis.` +
               ` Enter on a clean close or stop-limit above $${fp(recH)}, targeting $${fp(recH + aMult * a)} then $${fp(recH + aMult * a * 2)}.${invalidate}`;
      })(),
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
      thesis: (() => {
        const bbNote   = bbM ? ` First target is the BB mid-band (~$${fp(bbM)})${bbU ? `, then the upper band (~$${fp(bbU)})` : ""}.` : "";
        const structNote = sma200 && price > sma200
          ? ` The 200MA at $${fp(sma200)} is below, keeping the larger structure bullish — this is a dip in an uptrend, not a breakdown.`
          : ` Price is below the 200MA ($${fp(sma200 ?? 0)}), so this is a counter-trend bounce — size down.`;
        const divNote  = divBull
          ? ` Bullish RSI divergence (${ind.rsiDiv.description}) is the strongest signal here — price made a lower low but RSI didn't, suggesting sellers are exhausted.`
          : ` No RSI divergence yet — wait for a green candle close before entering; don't catch a falling knife.`;
        const volNote  = volRatio > 1.5 ? ` Volume spike (${(volRatio).toFixed(1)}× avg) suggests a capitulation flush.` : "";
        const stopNote = ` Hard stop at $${fp(price - 1.2 * a)} (1.2× ATR below entry).`;
        return `${sym} ($${fp(price)}) has RSI at ${r.toFixed(0)} with price at the lower Bollinger Band ($${fp(bbL ?? price)}), a textbook mean-reversion setup.` +
               `${volNote}${divNote}${structNote}${bbNote}${stopNote} Mean reversion fails fast in genuine downtrends — respect the stop.`;
      })(),
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
      thesis: (() => {
        const bbNote   = bbM ? ` First target is the BB mid-band (~$${fp(bbM)})${bbL ? `, then the lower band (~$${fp(bbL)})` : ""}.` : "";
        const structNote = sma200 && price < sma200
          ? ` The 200MA at $${fp(sma200)} is overhead, keeping the larger structure bearish — this is a rally into resistance.`
          : ` Price is above the 200MA ($${fp(sma200 ?? 0)}), so this is a counter-trend short — size down and respect the trend.`;
        const divNote  = divBear
          ? ` Bearish RSI divergence (${ind.rsiDiv.description}) is the key signal — price made a higher high but RSI didn't, revealing weakening momentum.`
          : ` No RSI divergence yet — wait for a red candle close before committing; fading strong trends is dangerous.`;
        const volNote  = volRatio > 1.5 ? ` Volume surge (${(volRatio).toFixed(1)}× avg) at the high may indicate a blow-off exhaustion.` : "";
        const stopNote = ` Hard stop at $${fp(price + 1.2 * a)} (1.2× ATR above entry).`;
        return `${sym} ($${fp(price)}) has RSI at ${r.toFixed(0)} with price at the upper Bollinger Band ($${fp(bbU ?? price)}), a potential exhaustion point.` +
               `${volNote}${divNote}${structNote}${bbNote}${stopNote} Counter-trend fades work best in ranges — a strong trend will run through your stop.`;
      })(),
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
