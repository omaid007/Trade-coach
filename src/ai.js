import { authHeaders } from "./api.js";

export async function fetchCommentary(snapshot) {
  const { getApiKey } = await import("./settings.js");
  const apiKey = getApiKey();
  const res = await fetch("/api/ai-commentary", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ snapshot, ...(apiKey ? { apiKey } : {}) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.text;
}

export function buildSnapshot(data, ind, setup, plan, style) {
  if (!data || !ind || !setup) return null;
  const i     = data.closes.length - 1;
  const price = data.closes[i];
  const prev  = data.meta.prevClose || data.closes[Math.max(0, i - 1)];
  const chgPct = prev ? ((price - prev) / prev * 100) : 0;

  const rsi    = ind.rsi?.[i];
  const sma50  = ind.sma50?.[i];
  const sma200 = ind.sma200?.[i];
  const macdH  = ind.macd?.hist?.[i];
  const macdH1 = ind.macd?.hist?.[i - 1];
  const atr    = ind.atr?.[i];

  let trend = "neutral";
  if (sma50 && sma200 && price > sma50 && sma50 > sma200) trend = "uptrend";
  else if (sma50 && sma200 && price < sma50 && sma50 < sma200) trend = "downtrend";
  else if (sma50 && price > sma50) trend = "above SMA50";
  else if (sma50 && price < sma50) trend = "below SMA50";

  let macd = "neutral";
  if (macdH != null && macdH1 != null) {
    if (macdH > 0 && macdH > macdH1)      macd = "bullish & strengthening";
    else if (macdH > 0 && macdH < macdH1) macd = "bullish but fading";
    else if (macdH < 0 && macdH < macdH1) macd = "bearish & weakening";
    else if (macdH < 0 && macdH > macdH1) macd = "bearish but recovering";
    else if (macdH1 < 0 && macdH > 0)     macd = "bullish crossover";
    else if (macdH1 > 0 && macdH < 0)     macd = "bearish crossover";
  }

  const entryMid = plan ? (plan.entry.lo + plan.entry.hi) / 2 : price;
  const t1price  = plan?.targets?.[0]?.price;
  const rr       = plan && plan.stop ? Math.abs(entryMid - (t1price ?? entryMid)) / Math.abs(entryMid - plan.stop) : null;

  return {
    symbol:     data.meta.symbol,
    style,
    price:      price.toFixed(2),
    changePct:  (chgPct >= 0 ? "+" : "") + chgPct.toFixed(2) + "%",
    setupName:  setup.name,
    direction:  setup.direction,
    confidence: setup.score ?? 0,
    trend,
    rsi:        rsi != null ? Math.round(rsi) : "—",
    macd,
    entryLo:    plan?.entry?.lo?.toFixed(2) ?? "—",
    entryHi:    plan?.entry?.hi?.toFixed(2) ?? "—",
    stop:       plan?.stop?.toFixed(2) ?? "—",
    t1:         t1price?.toFixed(2) ?? "—",
    rr:         rr != null ? rr.toFixed(1) : "—",
    atr:        atr != null ? atr.toFixed(2) : null,
  };
}

/** Extended snapshot with all technical context for AI plan generation. */
export function buildPlanSnapshot(data, ind, setup, plan, style) {
  const base = buildSnapshot(data, ind, setup, plan, style);
  if (!base) return null;

  const i        = data.closes.length - 1;
  const price    = data.closes[i];
  const macdHist = ind.macd?.hist?.[i];
  const sma20    = ind.sma20?.[i];
  const sma50    = ind.sma50?.[i];
  const sma200   = ind.sma200?.[i];
  const bbUpper  = ind.bb?.upper?.[i];
  const bbLower  = ind.bb?.lower?.[i];
  const rsi      = ind.rsi?.[i];
  const atr      = ind.atr?.[i];
  const vol      = data.volumes[i];
  const avgVol   = data.volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volRatio = avgVol > 0 ? vol / avgVol : 1;

  const bbPos = bbUpper && bbLower && bbUpper > bbLower
    ? Math.round(((price - bbLower) / (bbUpper - bbLower)) * 100) + "% of BB range"
    : "—";

  const rsiState = rsi == null ? "—"
    : rsi > 70 ? "overbought"
    : rsi < 30 ? "oversold"
    : rsi > 55 ? "bullish momentum"
    : rsi < 45 ? "bearish momentum"
    : "neutral";

  const t1 = plan?.targets?.[0];
  const t2 = plan?.targets?.[1];

  return {
    ...base,
    thesis:     setup?.thesis || "—",
    macdHist:   macdHist != null ? macdHist.toFixed(3) : "—",
    atrPct:     atr ? ((atr / price) * 100).toFixed(1) : "—",
    volRatio:   volRatio.toFixed(1),
    vsSma20:    sma20  ? (price > sma20  ? `above ($${sma20.toFixed(2)})`  : `below ($${sma20.toFixed(2)})`)  : "—",
    vsSma50:    sma50  ? (price > sma50  ? `above ($${sma50.toFixed(2)})`  : `below ($${sma50.toFixed(2)})`)  : "—",
    vsSma200:   sma200 ? (price > sma200 ? `above ($${sma200.toFixed(2)})` : `below ($${sma200.toFixed(2)})`) : "—",
    bbPosition: bbPos,
    rsiState,
    t2:         t2?.price?.toFixed(2) ?? "—",
    rr1:        t1?.rMult?.toFixed(1) ?? "—",
    rr2:        t2?.rMult?.toFixed(1) ?? "—",
    profitT1:   t1?.profit != null ? Math.round(t1.profit) : "—",
    profitT2:   t2?.profit != null ? Math.round(t2.profit) : "—",
    stopDist:   plan?.stopDist?.toFixed(2) ?? "—",
    shares:     plan?.shares ?? "—",
    dollarRisk: plan?.dollarRisk != null ? Math.round(plan.dollarRisk) : "—",
  };
}

export async function fetchAIPlan(snapshot) {
  const { getApiKey } = await import("./settings.js");
  const apiKey = getApiKey();
  const res = await fetch("/api/ai-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ snapshot, ...(apiKey ? { apiKey } : {}) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.text;
}
