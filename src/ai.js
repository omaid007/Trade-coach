export async function fetchCommentary(snapshot) {
  const { getApiKey } = await import("./settings.js");
  const apiKey = getApiKey();
  const res = await fetch("/api/ai-commentary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
