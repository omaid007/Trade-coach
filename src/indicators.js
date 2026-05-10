/**
 * Pure technical-indicator math. No DOM, no fetch.
 *
 * All indicators return arrays the same length as the input series, with
 * `null` for positions where there isn't enough data yet.
 */

/** Simple moving average. */
export function sma(arr, n) {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= n) sum -= arr[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Exponential moving average (seeded with SMA at position n-1). */
export function ema(arr, n) {
  const out = new Array(arr.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  let seed = 0;
  for (let i = 0; i < arr.length; i++) {
    if (i < n - 1) { seed += arr[i]; continue; }
    if (prev == null) { seed += arr[i]; prev = seed / n; }
    else prev = arr[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(0, ch)) / n;
    loss = (loss * (n - 1) + Math.max(0, -ch)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** MACD with default 12/26/9 parameters. */
export function macd(closes) {
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macdLine = closes.map((_, i) =>
    e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null
  );
  const start = macdLine.findIndex((v) => v != null);
  const valid = macdLine.slice(start);
  const sig = ema(valid, 9);
  const signal = new Array(start).fill(null).concat(sig);
  const hist = macdLine.map((v, i) =>
    v != null && signal[i] != null ? v - signal[i] : null
  );
  return { macd: macdLine, signal, hist };
}

/** Bollinger Bands. */
export function bollinger(closes, n = 20, k = 2) {
  const mid = sma(closes, n);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    let sumSq = 0;
    for (let j = i - n + 1; j <= i; j++) sumSq += (closes[j] - mid[i]) ** 2;
    const std = Math.sqrt(sumSq / n);
    upper[i] = mid[i] + k * std;
    lower[i] = mid[i] - k * std;
  }
  return { mid, upper, lower };
}

/** Wilder's Average True Range. */
export function atr(highs, lows, closes, n = 14) {
  const tr = [];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { tr.push(highs[i] - lows[i]); continue; }
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
  }
  const out = new Array(closes.length).fill(null);
  let prev = null;
  for (let i = n - 1; i < closes.length; i++) {
    if (prev == null) {
      let s = 0;
      for (let j = 0; j < n; j++) s += tr[j];
      prev = s / n;
    } else {
      prev = (prev * (n - 1) + tr[i]) / n;
    }
    out[i] = prev;
  }
  return out;
}

/**
 * Find swing highs and lows using a fractal definition:
 * a swing high is a bar whose high is greater than the `lb` bars on both sides.
 */
export function findSwings(highs, lows, lb = 4) {
  const sh = [];
  const sl = [];
  for (let i = lb; i < highs.length - lb; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - lb; j <= i + lb; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isHigh = false;
      if (lows[j] <= lows[i]) isLow = false;
    }
    if (isHigh) sh.push({ i, p: highs[i] });
    if (isLow) sl.push({ i, p: lows[i] });
  }
  return { sh, sl };
}

/** Standard Fibonacci retracement levels between a high and a low. */
export function fib(highest, lowest) {
  const range = highest - lowest;
  return {
    f0: highest,
    f236: highest - range * 0.236,
    f382: highest - range * 0.382,
    f500: highest - range * 0.5,
    f618: highest - range * 0.618,
    f786: highest - range * 0.786,
    f1: lowest,
  };
}

/** Fair Value Gaps — 3-candle price imbalance (unfilled delivery gap). */
export function findFVGs(opens, highs, lows, closes, lookback = 100) {
  const start = Math.max(2, closes.length - lookback);
  const bullish = [], bearish = [];
  for (let i = start; i < closes.length; i++) {
    if (lows[i] > highs[i - 2])  bullish.push({ i, top: lows[i],     bot: highs[i - 2] });
    if (highs[i] < lows[i - 2])  bearish.push({ i, top: lows[i - 2], bot: highs[i]     });
  }
  return { bullish, bearish };
}

/** Equal Highs / Lows — swing clusters within ATR tolerance (resting liquidity). */
export function findEqualLevels(swings, atrVal) {
  const tol = atrVal * 0.3;
  const group = (points) => {
    const groups = [];
    for (const pt of points) {
      const g = groups.find((x) => Math.abs(x.p - pt.p) < tol);
      if (g) {
        g.indices.push(pt.i);
        g.p = (g.p * (g.indices.length - 1) + pt.p) / g.indices.length;
      } else {
        groups.push({ p: pt.p, indices: [pt.i] });
      }
    }
    return groups.filter((g) => g.indices.length >= 2);
  };
  return { equalHighs: group(swings.sh), equalLows: group(swings.sl) };
}

/** Order Blocks — last opposing candle before a significant Break of Structure. */
export function findOrderBlocks(opens, highs, lows, closes, atrArr, lookback = 100) {
  const start = Math.max(3, closes.length - lookback);
  const bullish = [], bearish = [];
  const seenBull = new Set(), seenBear = new Set();
  for (let i = start + 2; i < closes.length; i++) {
    const a = atrArr[i] ?? (highs[i] - lows[i]);
    if ((closes[i] - closes[i - 2]) > 1.5 * a) {
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        if (!seenBull.has(j) && closes[j] < opens[j]) {
          seenBull.add(j);
          bullish.push({ i: j, top: opens[j], bot: closes[j] });
          break;
        }
      }
    }
    if ((closes[i - 2] - closes[i]) > 1.5 * a) {
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        if (!seenBear.has(j) && closes[j] > opens[j]) {
          seenBear.add(j);
          bearish.push({ i: j, top: closes[j], bot: opens[j] });
          break;
        }
      }
    }
  }
  return { bullish: bullish.slice(-5), bearish: bearish.slice(-5) };
}

/** RSI divergence — compares the two most recent swing high/low pairs. */
export function rsiDivergence(closes, rsiArr, swings) {
  const sh1 = swings.sh.at(-1), sh2 = swings.sh.at(-2);
  const sl1 = swings.sl.at(-1), sl2 = swings.sl.at(-2);
  const rH1 = sh1 ? rsiArr[sh1.i] : null;
  const rH2 = sh2 ? rsiArr[sh2.i] : null;
  const rL1 = sl1 ? rsiArr[sl1.i] : null;
  const rL2 = sl2 ? rsiArr[sl2.i] : null;
  if (sh1 && sh2 && rH1 != null && rH2 != null) {
    if (sh1.p > sh2.p && rH1 < rH2) return { type: "bearish",     description: `Bearish div — price HH, RSI LH (${rH2.toFixed(0)}→${rH1.toFixed(0)})` };
    if (sh1.p < sh2.p && rH1 > rH2) return { type: "hidden_bear", description: `Hidden bear div — price LH, RSI HH` };
  }
  if (sl1 && sl2 && rL1 != null && rL2 != null) {
    if (sl1.p < sl2.p && rL1 > rL2) return { type: "bullish",     description: `Bullish div — price LL, RSI HL (${rL2.toFixed(0)}→${rL1.toFixed(0)})` };
    if (sl1.p > sl2.p && rL1 < rL2) return { type: "hidden_bull", description: `Hidden bull div — price HL, RSI LL` };
  }
  return { type: null, description: "" };
}

/** Session VWAP — resets at each UTC day boundary. Uses integer day math (no Date objects). */
export function vwap(times, highs, lows, closes, volumes) {
  const out = new Array(closes.length).fill(null);
  let cumPV = 0, cumV = 0, lastDay = -1;
  for (let i = 0; i < closes.length; i++) {
    const day = (times[i] / 86400) | 0;
    if (day !== lastDay) { cumPV = 0; cumV = 0; lastDay = day; }
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    const v = volumes[i] || 0;
    cumPV += tp * v;
    cumV += v;
    out[i] = cumV > 0 ? cumPV / cumV : tp;
  }
  return out;
}

/** Previous session High / Low / Close — works for intraday and daily data. Uses integer day math. */
export function prevDayLevels(times, highs, lows, closes) {
  if (!times || times.length < 2) return { pdh: null, pdl: null, pdc: null };
  const todayDay = (times.at(-1) / 86400) | 0;
  let prevDay = -1, pdh = -Infinity, pdl = Infinity, pdc = null;
  for (let i = closes.length - 2; i >= 0; i--) {
    const day = (times[i] / 86400) | 0;
    if (day === todayDay) continue;
    if (prevDay === -1) prevDay = day;
    if (day !== prevDay) break;
    if (pdc === null) pdc = closes[i];
    if (highs[i] > pdh) pdh = highs[i];
    if (lows[i] < pdl) pdl = lows[i];
  }
  return {
    pdh: pdh === -Infinity ? null : pdh,
    pdl: pdl === Infinity ? null : pdl,
    pdc,
  };
}

/**
 * Compute every indicator we use, plus key levels (recent high/low, swings, fib).
 * @param {ReturnType<typeof import("./api.js").fetchOHLC>} d
 */
export function computeAll(d) {
  const c = d.closes, h = d.highs, l = d.lows, o = d.opens;
  const t = d.times, v = d.volumes;
  const ind = {
    sma20: sma(c, 20),
    sma50: sma(c, 50),
    sma200: sma(c, 200),
    ema12: ema(c, 12),
    ema26: ema(c, 26),
    rsi: rsi(c, 14),
    bb: bollinger(c, 20, 2),
    atr: atr(h, l, c, 14),
    macd: macd(c),
  };

  // Swings & key levels — last ~80 bars
  const lookback = Math.min(80, c.length);
  const sliceH = h.slice(-lookback);
  const sliceL = l.slice(-lookback);
  const swings = findSwings(sliceH, sliceL, 3);

  // Translate swing indices back to full series
  const offset = c.length - lookback;
  swings.sh.forEach((s) => (s.i += offset));
  swings.sl.forEach((s) => (s.i += offset));

  ind.swings = swings;
  ind.recentHigh = Math.max(...sliceH);
  ind.recentLow = Math.min(...sliceL);
  ind.fib = fib(ind.recentHigh, ind.recentLow);

  // ICT / SMC additions
  const atrNow = ind.atr.at(-1) ?? (h.at(-1) - l.at(-1));
  ind.fvgs        = findFVGs(o, h, l, c, 100);
  ind.equalLevels = findEqualLevels(swings, atrNow);
  ind.orderBlocks = findOrderBlocks(o, h, l, c, ind.atr, 100);
  ind.rsiDiv      = rsiDivergence(c, ind.rsi, swings);
  ind.vwap        = t && v ? vwap(t, h, l, c, v) : null;
  ind.prevDay     = t ? prevDayLevels(t, h, l, c) : null;

  return ind;
}
