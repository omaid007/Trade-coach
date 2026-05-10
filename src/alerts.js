const KEY = "tc_alerts_v1";
const POLL_MS = 30_000;

let _timer = null;
let _notifGranted = false;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch { return []; }
}
function save(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

async function fetchPrice(symbol) {
  const r    = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}&range=1d&interval=1d`);
  const json = await r.json();
  return json?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
}

function notify(text) {
  if (_notifGranted) new Notification("Trade Coach", { body: text });
}

async function pollAlerts() {
  const list   = load();
  const active = list.filter(a => !a.triggered);
  if (!active.length) { _timer = setTimeout(pollAlerts, POLL_MS); return; }

  const symbols = [...new Set(active.map(a => a.symbol))];
  const prices  = {};
  for (const sym of symbols) {
    try { prices[sym] = await fetchPrice(sym); } catch {}
  }

  let changed = false;
  for (const a of list) {
    if (a.triggered) continue;
    const px  = prices[a.symbol];
    if (px == null) continue;
    const hit = a.direction === "above" ? px >= a.price : px <= a.price;
    if (hit) {
      a.triggered    = true;
      a.triggeredAt  = new Date().toISOString();
      notify(`${a.symbol} hit $${a.price.toFixed(2)} (now $${px.toFixed(2)})`);
      changed = true;
    }
  }
  if (changed) { save(list); renderAlerts(); }
  _timer = setTimeout(pollAlerts, POLL_MS);
}

function renderAlerts() {
  const el = document.getElementById("alerts-list");
  if (!el) return;
  const list = load();
  if (!list.length) { el.innerHTML = `<div class="alerts-empty">No alerts set.</div>`; return; }
  el.innerHTML = list.slice().reverse().map(a => `
    <div class="alerts-row${a.triggered ? " triggered" : ""}">
      <span class="alerts-sym">${a.symbol}</span>
      ${a.triggered
        ? `<span class="alerts-badge hit">✓ hit</span>`
        : `<span class="alerts-badge">${a.direction} $${a.price.toFixed(2)}</span>`}
      <span class="alerts-time">${a.triggered ? a.triggeredAt?.slice(0, 10) : "active"}</span>
      <button class="alerts-del" data-id="${a.id}">✕</button>
    </div>`).join("");
}

function renderPermBtn() {
  const btn = document.getElementById("alerts-req-btn");
  if (!btn) return;
  if (!("Notification" in window)) { btn.style.display = "none"; return; }
  const granted = Notification.permission === "granted";
  btn.textContent = granted ? "✓ Notifications on" : "Enable notifications";
  btn.disabled    = granted;
  _notifGranted   = granted;
}

export function initAlerts() {
  if ("Notification" in window && Notification.permission === "granted") _notifGranted = true;

  document.getElementById("alerts-req-btn")?.addEventListener("click", async () => {
    const p = await Notification.requestPermission();
    _notifGranted = p === "granted";
    renderPermBtn();
  });

  document.getElementById("alerts-add-btn")?.addEventListener("click", () => {
    const sym   = (document.getElementById("alerts-sym")?.value  || "").trim().toUpperCase();
    const price = parseFloat(document.getElementById("alerts-price")?.value);
    const dir   = document.getElementById("alerts-dir")?.value;
    if (!sym || isNaN(price)) return;
    const list = load();
    list.push({ id: Date.now(), symbol: sym, price, direction: dir, triggered: false });
    save(list);
    renderAlerts();
  });

  document.getElementById("alerts-list")?.addEventListener("click", e => {
    if (!e.target.classList.contains("alerts-del")) return;
    const id = parseInt(e.target.dataset.id);
    save(load().filter(a => a.id !== id));
    renderAlerts();
  });

  renderPermBtn();
  renderAlerts();
  pollAlerts();
}

export function alertsSetSymbol(symbol) {
  const el = document.getElementById("alerts-sym");
  if (el) el.value = symbol;
}
