/**
 * Options flow — fetch + parse Yahoo Finance options chain.
 * Returns aggregate metrics: P/C ratios, ATM IV, unusual activity, top flow.
 */

import { apiFetch } from "./api.js";

export async function fetchOptionsFlow(symbol, date = null) {
  let path = `/api/options?symbol=${encodeURIComponent(symbol)}`;
  if (date) path += `&date=${date}`;
  const json = await apiFetch(path);
  return parseOptionsFlow(json);
}

function fmtExp(ts) {
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function parseOptionsFlow(json) {
  const result = json?.optionChain?.result?.[0];
  if (!result?.options?.length) return null;

  const price   = result.quote?.regularMarketPrice ?? 0;
  const opts    = result.options[0];
  const calls   = opts.calls ?? [];
  const puts    = opts.puts  ?? [];
  const allOpts = [
    ...calls.map(o => ({ ...o, type: "call" })),
    ...puts.map(o  => ({ ...o, type: "put"  })),
  ];

  const sum = (arr, key) => arr.reduce((s, o) => s + (o[key] || 0), 0);
  const callVol = sum(calls, "volume");
  const putVol  = sum(puts,  "volume");
  const callOI  = sum(calls, "openInterest");
  const putOI   = sum(puts,  "openInterest");

  // Dollar premium = last × volume × 100 shares/contract
  const dollarPremium = (o) => (o.lastPrice || 0) * (o.volume || 0) * 100;
  const callPremium = calls.reduce((s, o) => s + dollarPremium(o), 0);
  const putPremium  = puts.reduce((s, o)  => s + dollarPremium(o), 0);

  // ATM IV — average of the nearest call + put
  const nearest = (arr) => arr.reduce((b, o) =>
    !b || Math.abs(o.strike - price) < Math.abs(b.strike - price) ? o : b, null);
  const atmCall = nearest(calls);
  const atmPut  = nearest(puts);
  const atmIV   = ((atmCall?.impliedVolatility ?? 0) + (atmPut?.impliedVolatility ?? 0)) / 2;

  // Unusual: volume exceeds open interest today (fresh aggressive positioning)
  const unusual = allOpts
    .filter(o => o.volume >= 50 && o.openInterest > 0 && o.volume >= o.openInterest)
    .map(o    => ({ ...o, premium: dollarPremium(o), ratio: o.volume / o.openInterest }))
    .sort((a, b) => b.premium - a.premium)
    .slice(0, 8);

  // Top by dollar premium
  const top = (arr, type) => arr
    .filter(o => o.volume > 0)
    .map(o    => ({ ...o, type, premium: dollarPremium(o) }))
    .sort((a, b) => b.premium - a.premium)
    .slice(0, 6);

  // Sentiment from P/C vol ratio
  const pcr = callVol > 0 ? putVol / callVol : null;
  const sentiment =
    pcr == null ? "—" :
    pcr < 0.5  ? "Very Bullish" :
    pcr < 0.7  ? "Bullish" :
    pcr < 1.0  ? "Neutral-Bullish" :
    pcr < 1.3  ? "Neutral-Bearish" :
    pcr < 1.8  ? "Bearish" : "Very Bearish";

  const sentimentCls =
    pcr == null ? "" :
    pcr < 0.7  ? "pos" :
    pcr > 1.3  ? "neg" : "";

  return {
    symbol:   result.underlyingSymbol,
    price,
    expDate:  new Date(opts.expirationDate * 1000).toISOString().slice(0, 10),
    expLabel: fmtExp(opts.expirationDate),
    expirationDates: result.expirationDates ?? [],
    callVol, putVol, callOI, putOI,
    pcVolRatio: pcr,
    pcOIRatio:  callOI > 0 ? putOI / callOI : null,
    callPremium, putPremium,
    netFlow: callPremium - putPremium,
    atmIV:   atmIV > 0 ? atmIV : null,
    sentiment, sentimentCls,
    unusual,
    topCalls: top(calls, "call"),
    topPuts:  top(puts,  "put"),
  };
}
