/**
 * Turn a setup into a concrete trade plan with entry mid, stop distance,
 * R-multiple targets, and share count derived from account risk.
 *
 * 1R = abs(entry mid - stop). Each target reports an R-multiple so the
 * trader can see reward:risk at a glance.
 *
 * @param {object} setup     Output from detectSetups().
 * @param {number} price     Current/last price (used as fallback only).
 * @param {number} accountSize  Total account size in USD.
 * @param {number} riskPct      % of account risked on this trade (e.g. 1).
 */
function gradeSetup(score) {
  if (score >= 85) return { grade: "A+", mult: 1.00 };
  if (score >= 70) return { grade: "B",  mult: 0.75 };
  if (score >= 55) return { grade: "C",  mult: 0.50 };
  return                  { grade: "D",  mult: 0.25 };
}

export function buildPlan(setup, price, accountSize, riskPct) {
  if (setup.direction === "flat" || !setup.entry) {
    return { ...setup, accountSize, riskPct };
  }

  const entryMid = (setup.entry.lo + setup.entry.hi) / 2;
  const stopDist = Math.abs(entryMid - setup.stop);
  const { grade, mult } = gradeSetup(setup.score);
  const dollarRisk = accountSize * (riskPct / 100) * mult;
  const shares = stopDist > 0 ? Math.floor(dollarRisk / stopDist) : 0;

  const targets = setup.targets.map((t) => ({
    price: t,
    rMult: stopDist > 0 ? Math.abs(t - entryMid) / stopDist : 0,
    profit: shares * (t - entryMid) * (setup.direction === "long" ? 1 : -1),
  }));

  return {
    ...setup,
    entryMid,
    stopDist,
    dollarRisk,
    grade,
    qualityMult: mult,
    shares,
    targets,
    accountSize,
    riskPct,
  };
}
