import { STYLE_CONFIG } from "./config.js";

/**
 * Score and rank candidate trade setups for the current bar.
 *
 * Returns setups sorted by `score` (highest first). Each setup has the shape:
 *   { key, name, direction: "long"|"short"|"flat", score, entry: {lo, hi, ref},
 *     stop, targets: number[], thesis, signals: string[] }
 *
 * Scoring is heuristic — values are hand-tuned for confluence, not backtested.
 * Add new setups here; the highest-scoring one auto-wins.
 */
export function detectSetups(d, ind, style) {
  const i = d.closes.length - 1;
  const price = d.closes[i];
  const sma20 = ind.sma20[i];
  const sma50 = ind.sma50[i];
  const sma200 = ind.sma200[i];
  const r = ind.rsi[i] ?? 50;
  const histNow = ind.macd.hist[i] ?? 0;
  const histPrev = ind.macd.hist[i - 1] ?? 0;
  const a = ind.atr[i] ?? price * 0.02;
  const bbU = ind.bb.upper[i];
  const bbL = ind.bb.lower[i];
  const bbM = ind.bb.mid[i];
  const recH = ind.recentHigh;
  const recL = ind.recentLow;
  const aMult = STYLE_CONFIG[style].atrMult;

  // ICT confluence helpers
  const nearFVG = (fvgArr, direction) => {
    if (!fvgArr || !fvgArr.length) return false;
    return fvgArr.some((f) => price >= f.bot - a * 0.5 && price <= f.top + a * 0.5);
  };
  const fvgBullBoost = (ind.fvgs && nearFVG(ind.fvgs.bullish, "bull")) ? 10 : 0;
  const fvgBearBoost = (ind.fvgs && nearFVG(ind.fvgs.bearish, "bear")) ? 10 : 0;
  const obBullBoost  = (ind.orderBlocks?.bullish?.some((ob) => price >= ob.bot && price <= ob.top + a)) ? 8 : 0;
  const obBearBoost  = (ind.orderBlocks?.bearish?.some((ob) => price <= ob.top && price >= ob.bot - a)) ? 8 : 0;
  const divType = ind.rsiDiv?.type;
  const divBullBoost = (divType === "bullish" || divType === "hidden_bull") ? 12 : 0;
  const divBearBoost = (divType === "bearish" || divType === "hidden_bear") ? 12 : 0;

  const setups = [];

  /* ---- 1. Bullish trend continuation ---- */
  if (sma50 != null && sma200 != null && price > sma50 && sma50 > sma200) {
    const proxSMA20 = sma20 ? Math.abs(price - sma20) / price : 0.05;
    const score =
      60 +
      (r > 50 && r < 70 ? 10 : 0) +
      (histNow > 0 ? 8 : 0) +
      (proxSMA20 < 0.03 ? 12 : proxSMA20 < 0.06 ? 6 : 0) +
      (price > sma200 * 1.05 ? 5 : 0) +
      fvgBullBoost + obBullBoost + divBullBoost;
    const sigs = ["50MA > 200MA", `RSI ${r.toFixed(0)}`, histNow > 0 ? "MACD bullish" : "MACD weak"];
    if (fvgBullBoost) sigs.push("Bullish FVG");
    if (obBullBoost)  sigs.push("At Order Block");
    if (divBullBoost) sigs.push(ind.rsiDiv.description);
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
        `RSI ${r.toFixed(0)} is constructive without being overbought. Buy a pullback toward ` +
        `the 20-period MA — bulls typically defend that line in healthy trends.`,
      signals: sigs,
    });
  }

  /* ---- 2. Bearish trend continuation ---- */
  if (sma50 != null && sma200 != null && price < sma50 && sma50 < sma200) {
    const score =
      55 +
      (r < 50 && r > 30 ? 10 : 0) +
      (histNow < 0 ? 8 : 0) +
      (sma20 && Math.abs(price - sma20) / price < 0.03 ? 12 : 0) +
      fvgBearBoost + obBearBoost + divBearBoost;
    const sigs = ["50MA < 200MA", `RSI ${r.toFixed(0)}`, histNow < 0 ? "MACD bearish" : "MACD weak"];
    if (fvgBearBoost) sigs.push("Bearish FVG");
    if (obBearBoost)  sigs.push("At Order Block");
    if (divBearBoost) sigs.push(ind.rsiDiv.description);
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
        `sellers typically reload there.`,
      signals: sigs,
    });
  }

  /* ---- 3. Breakout long ---- */
  const distToHigh = (recH - price) / price;
  if (distToHigh < 0.015 && distToHigh > -0.01 && r > 55) {
    const eqHBoost = (ind.equalLevels?.equalHighs?.some((g) => Math.abs(g.p - recH) < a)) ? 8 : 0;
    const score = 65 + (histNow > histPrev ? 10 : 0) + (sma50 && price > sma50 ? 8 : 0) + fvgBullBoost + eqHBoost;
    const sigs = ["At 20-bar high", `RSI ${r.toFixed(0)}`, "Momentum building"];
    if (eqHBoost)    sigs.push("Equal Highs — liquidity above");
    if (fvgBullBoost) sigs.push("Bullish FVG support");
    setups.push({
      key: "breakout_long",
      name: "Breakout Long",
      direction: "long",
      score,
      entry: { lo: recH, hi: recH * 1.005, ref: "above 20-period high" },
      stop: recH - aMult * a,
      targets: [recH + aMult * a, recH + aMult * a * 2, recH + aMult * a * 3],
      thesis:
        `Price is coiled at the recent high. A clean break with momentum often runs another ATR ` +
        `or two as shorts cover and breakout buyers pile in. Use a stop-limit BUY just above the high.`,
      signals: sigs,
    });
  }

  /* ---- 4. Oversold mean-reversion long ---- */
  if (r < 35 && bbL && price <= bbL * 1.01) {
    const score = 50 + (r < 30 ? 12 : 0) + (sma200 && price > sma200 ? 8 : 0) + fvgBullBoost + obBullBoost + divBullBoost;
    const sigs = [`RSI ${r.toFixed(0)} oversold`, "At lower BB", "Tight stop required"];
    if (fvgBullBoost) sigs.push("Bullish FVG");
    if (obBullBoost)  sigs.push("At Order Block");
    if (divBullBoost) sigs.push(ind.rsiDiv.description);
    setups.push({
      key: "oversold_long",
      name: "Oversold Bounce (Mean Reversion)",
      direction: "long",
      score,
      entry: { lo: price * 0.995, hi: price * 1.005, ref: "current price (limit)" },
      stop: price - 1.2 * a,
      targets: [bbM, sma20 || bbM, bbU],
      thesis:
        `RSI at ${r.toFixed(0)} is oversold and price has tagged the lower Bollinger Band. ` +
        `Mean-reversion bounces target the mid-band first. Keep the stop tight — mean reversion ` +
        `fails fast in real downtrends.`,
      signals: sigs,
    });
  }

  /* ---- 5. Overbought mean-reversion short ---- */
  if (r > 70 && bbU && price >= bbU * 0.99) {
    const score = 45 + (r > 75 ? 12 : 0) + fvgBearBoost + obBearBoost + divBearBoost;
    const sigs = [`RSI ${r.toFixed(0)} overbought`, "At upper BB", "Counter-trend"];
    if (fvgBearBoost) sigs.push("Bearish FVG");
    if (obBearBoost)  sigs.push("At Order Block");
    if (divBearBoost) sigs.push(ind.rsiDiv.description);
    setups.push({
      key: "overbought_short",
      name: "Overbought Fade (Mean Reversion)",
      direction: "short",
      score,
      entry: { lo: price * 0.995, hi: price * 1.01, ref: "current price (limit)" },
      stop: price + 1.2 * a,
      targets: [bbM, sma20 || bbM, bbL],
      thesis:
        `RSI at ${r.toFixed(0)} is overbought with price riding the upper Bollinger Band. ` +
        `Counter-trend fades work best in ranges, not strong uptrends — use a tight stop.`,
      signals: sigs,
    });
  }

  /* ---- 6. Fallback: stand aside ---- */
  if (setups.length === 0 || setups[0].score < 50) {
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
