/** Number/percent formatting helpers used by render.js. */

export const f2 = (v) =>
  v == null
    ? "—"
    : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const f0 = (v) =>
  v == null ? "—" : Math.round(v).toLocaleString("en-US");

export const fpct = (v) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";

export const fchg = (v) => (v >= 0 ? "+" : "") + v.toFixed(2);

/** Returns CSS class name "pos" or "neg" based on sign. */
export const sgn = (v) => (v >= 0 ? "pos" : "neg");
