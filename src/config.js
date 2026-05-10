export const STYLE_CONFIG = {
  day:      { range: "5d",  interval: "15m", atrMult: 1.0, label: "Day Trade",      horizon: "Same session" },
  swing:    { range: "6mo", interval: "1d",  atrMult: 2.0, label: "Swing Trade",    horizon: "3–15 trading days" },
  position: { range: "5y",  interval: "1wk", atrMult: 3.0, label: "Position Trade", horizon: "2–6 months" },
};

export const DEFAULTS = {
  symbol: "AAPL",
  style: "swing",
  accountSize: 10000,
  riskPct: 1,
};
