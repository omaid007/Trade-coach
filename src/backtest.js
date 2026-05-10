/**
 * Walk the last N bars looking for historical occurrences of the current setup.
 * Forward-test each: 2R target, 1R stop, 15-bar window.
 */
export function runBacktest(data, ind, setup) {
  if (!setup || !data || data.closes.length < 60) return null;

  const { closes, highs, lows, volumes } = data;
  const n        = closes.length;
  const lookback = Math.min(150, n - 20);
  const sma20    = ind.sma20  ?? [];
  const sma50    = ind.sma50  ?? [];
  const rsi      = ind.rsi    ?? [];
  const atr      = ind.atr    ?? [];

  const hits = [];

  for (let i = n - lookback; i < n - 15; i++) {
    if (!matchesSetup(setup.key, i, closes, highs, lows, volumes, sma20, sma50, rsi)) continue;

    const entryPrice  = closes[i];
    const riskAmt     = atr[i] ?? entryPrice * 0.02;
    const dir         = setup.direction === "short" ? -1 : 1;
    const targetPrice = entryPrice + dir * riskAmt * 2;
    const stopPrice   = entryPrice - dir * riskAmt;

    let outcome = "open", exitR = 0;
    for (let j = i + 1; j <= Math.min(i + 15, n - 1); j++) {
      if (dir > 0 ? lows[j] <= stopPrice  : highs[j] >= stopPrice)  { outcome = "loss"; exitR = -1; break; }
      if (dir > 0 ? highs[j] >= targetPrice : lows[j] <= targetPrice) { outcome = "win";  exitR =  2; break; }
    }

    hits.push({ outcome, exitR });
  }

  if (!hits.length) return { occurrences: 0, wins: 0, losses: 0, avgR: 0, winRate: 0 };

  const wins   = hits.filter(h => h.outcome === "win").length;
  const losses = hits.filter(h => h.outcome === "loss").length;
  const avgR   = hits.reduce((a, h) => a + h.exitR, 0) / hits.length;

  return {
    occurrences: hits.length,
    wins,
    losses,
    winRate: (wins / hits.length) * 100,
    avgR,
  };
}

function matchesSetup(key, i, closes, highs, lows, volumes, sma20, sma50, rsi) {
  const c  = closes[i], c1 = closes[i - 1], c2 = closes[i - 2];
  if (c == null || c1 == null) return false;

  switch (key) {
    case "pullback_long":
    case "ma_pullback_long": {
      const ma = sma20[i];
      return !!ma && c > ma && c1 < ma * 1.005 && c > c1;
    }
    case "breakout_long": {
      const r20hi = Math.max(...highs.slice(Math.max(0, i - 20), i));
      const v20   = volumes.slice(Math.max(0, i - 20), i);
      const avgV  = v20.reduce((a, x) => a + x, 0) / (v20.length || 1);
      return closes[i] > r20hi && (volumes[i] || 0) > avgV * 1.2;
    }
    case "oversold_bounce":
    case "rsi_reversal_long": {
      const r = rsi[i], r1 = rsi[i - 1];
      return r != null && r1 != null && r1 < 35 && r > r1 && c > c1;
    }
    case "trend_continuation_long": {
      const ma = sma50[i];
      return !!ma && c > ma && c > c1 && c1 > (c2 ?? 0);
    }
    case "pullback_short":
    case "ma_pullback_short": {
      const ma = sma20[i];
      return !!ma && c < ma && c1 > ma * 0.995 && c < c1;
    }
    case "rsi_reversal_short": {
      const r = rsi[i], r1 = rsi[i - 1];
      return r != null && r1 != null && r1 > 65 && r < r1 && c < c1;
    }
    default:
      return c > c1;
  }
}
