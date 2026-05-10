/**
 * ICT kill-zone session awareness — pure time math, no API.
 * All times are Eastern (America/New_York).
 */

const KILL_ZONES = [
  { name: "Asian Session",     start: [19,  0], end: [23,  0], quality: "avoid"  },
  { name: "London Open",       start: [ 2,  0], end: [ 5,  0], quality: "high"   },
  { name: "NY Pre-Market",     start: [ 7,  0], end: [ 9, 30], quality: "medium" },
  { name: "NY Open",           start: [ 9, 30], end: [11,  0], quality: "high"   },
  { name: "London Close",      start: [10,  0], end: [12,  0], quality: "medium" },
  { name: "Lunch / Dead Zone", start: [12,  0], end: [13, 30], quality: "avoid"  },
  { name: "NY Afternoon",      start: [13, 30], end: [15,  0], quality: "medium" },
  { name: "Power Hour",        start: [15,  0], end: [16,  0], quality: "high"   },
  { name: "After Hours",       start: [16,  0], end: [19,  0], quality: "avoid"  },
];

const _dtf = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric", minute: "numeric", hour12: false,
});

function etMinutes() {
  const parts = _dtf.formatToParts(new Date());
  const h = parseInt(parts.find(p => p.type === "hour").value);
  const m = parseInt(parts.find(p => p.type === "minute").value);
  return { h, m, mins: h * 60 + m };
}

function fmtCountdown(diff) {
  if (diff <= 0) return "now";
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Returns the current ICT session state. */
export function getSession() {
  const { h, m, mins } = etMinutes();
  const timeET = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ET`;

  let current = null;
  for (const kz of KILL_ZONES) {
    const [sh, sm] = kz.start;
    const [eh, em] = kz.end;
    const start = sh * 60 + sm;
    const end   = eh * 60 + em;
    const inKz  = end < start
      ? (mins >= start || mins < end)
      : (mins >= start && mins < end);
    if (inKz) { current = kz; break; }
  }

  // Find next high/medium session
  let nextName = null, minsToNext = null;
  for (const kz of KILL_ZONES) {
    if (kz.quality === "avoid") continue;
    const [sh, sm] = kz.start;
    let diff = (sh * 60 + sm) - mins;
    if (diff <= 0) diff += 24 * 60;
    if (minsToNext === null || diff < minsToNext) {
      minsToNext = diff;
      nextName = kz.name;
    }
  }

  if (!current) {
    return { name: "Off-Hours", quality: "avoid", timeET, nextName, minsToNext, countdown: fmtCountdown(minsToNext) };
  }

  // Remaining time in current session
  const [eh, em] = current.end;
  let remaining = (eh * 60 + em) - mins;
  if (remaining < 0) remaining += 24 * 60;

  return {
    name: current.name,
    quality: current.quality,   // "high" | "medium" | "avoid"
    timeET,
    remaining,
    nextName,
    minsToNext,
    countdown: fmtCountdown(minsToNext),
  };
}
