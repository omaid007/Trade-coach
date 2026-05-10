import { f2, f0 } from "./format.js";

const BASE = "/api/tastytrade";

// Module-level state — persists across re-renders
let _session       = sessionStorage.getItem("tt_session")  || localStorage.getItem("tt_session")  || null;
let _accountNumber = sessionStorage.getItem("tt_account")  || localStorage.getItem("tt_account")  || null;
let _rememberedUser = localStorage.getItem("tt_username") || null;
let _accounts = [];
let _plan = null;
let _symbol = null;
let _style = null;

// ─── API ──────────────────────────────────────────────────────────────────────

async function ttFetch(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(_session ? { "x-tt-session": _session } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function login(username, password, challengeToken = null, otp = null, remember = false) {
  const body = { username, password };
  if (challengeToken) body.challengeToken = challengeToken;
  if (otp) body.otp = otp;

  const data = await ttFetch("/session", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (data.challengeRequired) return data; // { challengeRequired, challengeToken }

  _session = data.sessionToken;
  sessionStorage.setItem("tt_session", _session);

  if (remember) {
    localStorage.setItem("tt_session",  _session);
    localStorage.setItem("tt_username", username);
    _rememberedUser = username;
  }

  return data;
}

async function logout() {
  await ttFetch("/session", { method: "DELETE" }).catch(() => {});
  _session = null;
  _accountNumber = null;
  _accounts = [];
  _rememberedUser = null;
  sessionStorage.removeItem("tt_session");
  sessionStorage.removeItem("tt_account");
  localStorage.removeItem("tt_session");
  localStorage.removeItem("tt_account");
  localStorage.removeItem("tt_username");
}

async function fetchAccounts() {
  _accounts = await ttFetch("/accounts");
  // Auto-select if only one account, or restore saved selection
  const saved = _accounts.find(a => a.accountNumber === _accountNumber);
  if (!saved) {
    _accountNumber = _accounts.length === 1 ? _accounts[0].accountNumber : null;
    if (_accountNumber) {
      sessionStorage.setItem("tt_account", _accountNumber);
      if (_rememberedUser) localStorage.setItem("tt_account", _accountNumber);
    } else {
      sessionStorage.removeItem("tt_account");
    }
  }
}

async function fetchBalances() {
  return ttFetch(`/accounts/${_accountNumber}/balances`);
}

async function dryRun(order) {
  return ttFetch(`/accounts/${_accountNumber}/orders/dry-run`, {
    method: "POST",
    body: JSON.stringify(order),
  });
}

async function placeOrder(order) {
  return ttFetch(`/accounts/${_accountNumber}/orders`, {
    method: "POST",
    body: JSON.stringify(order),
  });
}

function buildOrder() {
  if (!_plan || _plan.direction === "flat" || !_symbol) return null;
  const isBreakout = _plan.key === "breakout_long";
  const order = {
    "time-in-force": _style === "day" ? "Day" : "GTC",
    "order-type": isBreakout ? "Stop Limit" : "Limit",
    "price": _plan.entry.hi,
    "legs": [{
      "instrument-type": "Equity",
      "symbol": _symbol,
      "quantity": _plan.shares,
      "action": _plan.direction === "long" ? "Buy to Open" : "Sell to Open",
    }],
  };
  if (isBreakout) order["stop-trigger"] = _plan.entry.lo;
  return order;
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

const el = id => document.getElementById(id);

function renderTTChart(symbol, style) {
  const container = el("tt-chart-container");
  if (!container || !symbol) return;
  const intervalMap = { day: "15", swing: "D", position: "W" };
  const interval = intervalMap[style] || "D";
  const url =
    `https://s.tradingview.com/widgetembed/?frameElementId=tt_chart` +
    `&symbol=${encodeURIComponent(symbol)}&interval=${interval}` +
    `&hidesidetoolbar=0&theme=dark&style=1&timezone=Etc/UTC` +
    `&withdateranges=1&hideideas=1` +
    `&studies=%5B%22MASimple%40tv-basicstudies%22%2C%22RSI%40tv-basicstudies%22%5D`;
  container.innerHTML =
    `<iframe src="${url}" allowtransparency="true" scrolling="no" allowfullscreen style="width:100%;height:100%;border:none;"></iframe>`;
}

function setTab(name) {
  document.querySelectorAll("[data-tt-tab]").forEach(t => {
    const active = t.dataset.ttTab === name;
    t.classList.toggle("active", active);
    const panel = el("tt-panel-" + t.dataset.ttTab);
    if (panel) panel.classList.toggle("active", active);
  });
  if (name === "order")                  renderOrder();
  if (name === "account" && _session)   renderAccount();
  if (name === "auto")                   renderAutoTrader();
}

function setStatus(text, cls = "") {
  const s = el("tt-status");
  if (!s) return;
  s.textContent = text;
  s.className = "pill" + (cls ? " " + cls : "");
}

// ─── Render: Connect tab ──────────────────────────────────────────────────────

function renderConnect() {
  const panel = el("tt-panel-connect");
  if (!panel) return;

  // Already connected via remembered session — show connected state
  if (_session && _rememberedUser) {
    panel.innerHTML = `
      <div style="max-width: 360px;">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
          <span style="font-size:20px;">✓</span>
          <div>
            <div style="font-weight:600; color:var(--green);">Remembered session active</div>
            <div style="font-size:12px; color:var(--text-dim);">Signed in as <strong>${_rememberedUser}</strong></div>
          </div>
        </div>
        <p style="color:var(--text-dim); font-size:12px; margin:0 0 12px 0;">
          Your session was restored from a previous login. Switch to the Account tab to load balances.
        </p>
        <button id="tt-forget-btn" style="font-size:12px; color:var(--red); border-color:rgba(255,94,108,0.4);">
          Forget &amp; Disconnect
        </button>
      </div>`;
    el("tt-forget-btn").addEventListener("click", async () => {
      await logout();
      setStatus("not connected");
      el("tt-panel-account").innerHTML = `<p class="loading">Not connected.</p>`;
      el("tt-panel-order").innerHTML   = `<p class="loading">Not connected.</p>`;
      renderConnect();
    });
    return;
  }

  panel.innerHTML = `
    <div style="max-width: 360px;">
      <p style="color: var(--text-dim); font-size: 13px; margin: 0 0 16px 0;">
        Connect your Tastytrade account to view balances and place orders directly from the trade plan.
        Credentials are never stored — only the session token is kept.
      </p>

      <div id="tt-step-credentials" style="display: flex; flex-direction: column; gap: 8px;">
        <input id="tt-username" type="text" placeholder="Tastytrade username" autocomplete="username" />
        <input id="tt-password" type="password" placeholder="Password" autocomplete="current-password" />
        <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-dim); cursor:pointer; user-select:none;">
          <input id="tt-remember" type="checkbox" style="width:auto; margin:0;" />
          Remember me (saves session to this browser)
        </label>
        <button id="tt-login-btn" class="primary">Connect</button>
      </div>

      <div id="tt-step-otp" style="display: none; flex-direction: column; gap: 8px;">
        <p style="color: var(--amber); font-size: 13px; margin: 0;">
          Tastytrade sent a verification code to your email. Enter it below.
        </p>
        <input id="tt-otp" type="text" placeholder="Verification code" autocomplete="one-time-code"
          inputmode="numeric" style="letter-spacing: 4px; font-size: 18px;" />
        <button id="tt-verify-btn" class="primary">Verify</button>
        <button id="tt-back-btn" style="font-size: 12px;">← Back</button>
      </div>

      <div id="tt-login-error" class="error" style="display:none; margin-top: 8px;"></div>
    </div>`;

  let _pendingUsername = "";
  let _pendingPassword = "";
  let _pendingChallenge = "";
  let _pendingRemember = false;

  async function doLogin() {
    const errEl = el("tt-login-error");
    const btn = el("tt-login-btn");
    errEl.style.display = "none";
    btn.textContent = "Connecting…";
    btn.disabled = true;
    try {
      _pendingUsername = el("tt-username").value.trim();
      _pendingPassword = el("tt-password").value;
      _pendingRemember = el("tt-remember").checked;
      const result = await login(_pendingUsername, _pendingPassword, null, null, _pendingRemember);
      if (result.challengeRequired) {
        _pendingChallenge = result.challengeToken;
        showOtpStep();
        return;
      }
      await onConnected();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = "block";
    } finally {
      btn.textContent = "Connect";
      btn.disabled = false;
    }
  }

  async function doVerify() {
    const errEl = el("tt-login-error");
    const btn = el("tt-verify-btn");
    errEl.style.display = "none";
    btn.textContent = "Verifying…";
    btn.disabled = true;
    try {
      const otp = el("tt-otp").value.trim();
      await login(_pendingUsername, _pendingPassword, _pendingChallenge, otp, _pendingRemember);
      await onConnected();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = "block";
    } finally {
      btn.textContent = "Verify";
      btn.disabled = false;
    }
  }

  async function onConnected() {
    await fetchAccounts();
    setStatus("connected", "bull");
    renderConnect(); // re-render to show remembered state if applicable
    renderAccount();
    setTab("account");
  }

  function showOtpStep() {
    el("tt-step-credentials").style.display = "none";
    el("tt-step-otp").style.display = "flex";
    el("tt-otp").focus();
  }

  el("tt-login-btn").addEventListener("click", doLogin);
  el("tt-password").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  el("tt-verify-btn").addEventListener("click", doVerify);
  el("tt-otp").addEventListener("keydown", e => { if (e.key === "Enter") doVerify(); });
  el("tt-back-btn").addEventListener("click", () => {
    el("tt-step-otp").style.display = "none";
    el("tt-step-credentials").style.display = "flex";
    el("tt-login-error").style.display = "none";
  });
}

// ─── Render: Account tab ──────────────────────────────────────────────────────

function renderAccount() {
  const panel = el("tt-panel-account");
  if (!panel) return;

  if (!_session) {
    panel.innerHTML = `<p class="loading">Not connected — go to the Connect tab.</p>`;
    return;
  }

  const opts = _accounts.map(a =>
    `<option value="${a.accountNumber}" ${a.accountNumber === _accountNumber ? "selected" : ""}>
      ${a.nickname || a.accountNumber} · ${a.accountType}
    </option>`
  ).join("");

  panel.innerHTML = `
    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px;">
      <select id="tt-account-select" style="flex: 1; min-width: 220px;">${opts}</select>
      <button id="tt-load-bal" class="primary" style="font-size: 12px;">Load balances</button>
      <button id="tt-disconnect" style="font-size: 12px;">Disconnect</button>
    </div>
    <div id="tt-balances">
      <p style="color: var(--text-faint); font-size: 13px; margin: 0;">
        Click "Load balances" to fetch account info.
      </p>
    </div>`;

  el("tt-account-select").addEventListener("change", () => {
    _accountNumber = el("tt-account-select").value;
    sessionStorage.setItem("tt_account", _accountNumber);
    el("tt-balances").innerHTML =
      `<p style="color: var(--text-faint); font-size: 13px; margin:0;">Account changed — click "Load balances" to refresh.</p>`;
  });

  el("tt-load-bal").addEventListener("click", async () => {
    const btn = el("tt-load-bal");
    btn.textContent = "Loading…";
    btn.disabled = true;
    try {
      const b = await fetchBalances();
      el("tt-balances").innerHTML = `
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <div class="plan-cell" style="flex:1; min-width:120px;">
            <div class="lbl">Net Liquidation</div>
            <div class="val">$${f2(b.netLiq)}</div>
          </div>
          <div class="plan-cell" style="flex:1; min-width:120px;">
            <div class="lbl">Cash Balance</div>
            <div class="val">$${f2(b.cashBalance)}</div>
          </div>
          <div class="plan-cell" style="flex:1; min-width:120px;">
            <div class="lbl">Buying Power</div>
            <div class="val">$${f2(b.buyingPower)}</div>
          </div>
        </div>`;
    } catch (e) {
      el("tt-balances").innerHTML = `<span class="error">${e.message}</span>`;
    } finally {
      btn.textContent = "Load balances";
      btn.disabled = false;
    }
  });

  el("tt-disconnect").addEventListener("click", async () => {
    await logout();
    setStatus("not connected");
    renderConnect();
    el("tt-panel-account").innerHTML = `<p class="loading">Not connected.</p>`;
    el("tt-panel-order").innerHTML = `<p class="loading">Not connected.</p>`;
    setTab("connect");
  });
}

// ─── Render: Order tab ────────────────────────────────────────────────────────

function renderOrder() {
  const panel = el("tt-panel-order");
  if (!panel) return;

  if (!_session) {
    panel.innerHTML = `<p class="loading">Connect to Tastytrade first.</p>`;
    return;
  }
  if (!_accountNumber) {
    panel.innerHTML = `<p class="loading">Select an account in the Account tab first.</p>`;
    return;
  }
  if (!_plan || _plan.direction === "flat") {
    panel.innerHTML = `<p style="color: var(--text-dim); font-size: 13px;">No actionable setup — analyze a ticker to populate the order.</p>`;
    return;
  }

  const order = buildOrder();
  const isBreakout = _plan.key === "breakout_long";
  const action = _plan.direction === "long" ? "Buy to Open" : "Sell to Open";
  const tif = _style === "day" ? "Day" : "GTC";

  panel.innerHTML = `
    <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 8px;">
      Entry order · account <strong style="color:var(--text);">${_accountNumber}</strong>
    </div>
    <div class="ticket" style="margin-bottom: 10px;">
<span class="k">Symbol:</span>       <span class="v">${_symbol}</span>
<span class="k">Action:</span>       <span class="v">${action}</span>
<span class="k">Order type:</span>   <span class="v">${isBreakout ? "Stop Limit" : "Limit"}</span>
<span class="k">Quantity:</span>     <span class="v">${_plan.shares} shares</span>${isBreakout ? `
<span class="k">Stop trigger:</span> <span class="v">$${f2(_plan.entry.lo)}</span>` : ""}
<span class="k">Limit price:</span>  <span class="v">$${f2(_plan.entry.hi)}</span>
<span class="k">Time-in-force:</span> <span class="v">${tif}</span>
    </div>
    <div class="disclaimer" style="margin-bottom: 12px; margin-top: 0;">
      After fill, manually place a stop-loss at <strong>$${f2(_plan.stop)}</strong>
      and take-profit at <strong>$${f2(_plan.targets[1].price)}</strong> as a separate OCO order in Tastytrade.
    </div>
    <div style="display: flex; gap: 8px; align-items: center;">
      <button id="tt-dry-run" class="primary" style="font-size: 12px;">Validate order</button>
      <button id="tt-place" style="font-size: 12px; display:none;">⚡ Place Order</button>
    </div>
    <div id="tt-result" style="margin-top: 10px;"></div>`;

  el("tt-dry-run").addEventListener("click", async () => {
    const btn = el("tt-dry-run");
    const resultEl = el("tt-result");
    btn.textContent = "Validating…";
    btn.disabled = true;
    resultEl.innerHTML = "";
    try {
      const r = await dryRun(order);
      const bp = Math.abs(parseFloat(r.data?.["buying-power-effect"]?.["change-in-buying-power"] ?? 0));
      const fees = parseFloat(r.data?.["fee-calculation"]?.["total-fees"] ?? 0);
      resultEl.innerHTML = `
        <div class="tt-result-ok">
          <div style="color:var(--green); font-weight:600; margin-bottom:6px;">✓ Order validated</div>
          <div>Buying power impact: <strong>$${f2(bp)}</strong></div>
          <div>Estimated fees: <strong>$${f2(fees)}</strong></div>
        </div>
        <div style="margin-top:8px; font-size:12px; color:var(--amber);">
          Review carefully. This will be a real order on your live account.
        </div>`;
      el("tt-place").style.display = "inline-block";
    } catch (e) {
      resultEl.innerHTML = `<span class="error">${e.message}</span>`;
    } finally {
      btn.textContent = "Validate order";
      btn.disabled = false;
    }
  });

  el("tt-place").addEventListener("click", async () => {
    const btn = el("tt-place");
    const resultEl = el("tt-result");
    if (!confirm(`Place ${_plan.shares} share(s) of ${_symbol} on Tastytrade?\n\nThis is a real order on your live account.`)) return;
    btn.textContent = "Placing…";
    btn.disabled = true;
    try {
      const r = await placeOrder(order);
      const orderId = r.data?.order?.id ?? r.data?.id ?? "submitted";
      resultEl.innerHTML = `
        <div class="tt-result-ok">
          <div style="color:var(--green); font-weight:700;">✓ Order placed!</div>
          <div style="margin-top:4px;">Order ID: <strong>${orderId}</strong></div>
          <div style="margin-top:4px; font-size:12px; color:var(--text-dim);">
            Check Tastytrade for status. Don't forget your stop-loss OCO.
          </div>
        </div>`;
      btn.style.display = "none";
    } catch (e) {
      resultEl.innerHTML = `<span class="error">${e.message}</span>`;
      btn.textContent = "⚡ Place Order";
      btn.disabled = false;
    }
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initTastytrade() {
  document.querySelectorAll("[data-tt-tab]").forEach(t => {
    t.addEventListener("click", () => setTab(t.dataset.ttTab));
  });

  renderConnect();

  if (_session) {
    setStatus("connected", "bull");
    fetchAccounts()
      .then(() => {
        renderConnect();
        renderAccount();
      })
      .catch(() => {
        _session = null;
        _rememberedUser = null;
        sessionStorage.removeItem("tt_session");
        sessionStorage.removeItem("tt_account");
        localStorage.removeItem("tt_session");
        localStorage.removeItem("tt_account");
        localStorage.removeItem("tt_username");
        setStatus("session expired");
        renderConnect();
      });
  } else {
    setStatus("not connected");
  }
}

export function updateTastytradeOrder(plan, symbol, style) {
  _plan = plan;
  _symbol = symbol;
  _style = style;
  AT.plan   = plan;
  AT.symbol = symbol;
  AT.style  = style;
  renderTTChart(symbol, style);
  const orderPanel = el("tt-panel-order");
  if (orderPanel?.classList.contains("active")) renderOrder();
  const autoPanel = el("tt-panel-auto");
  if (autoPanel?.classList.contains("active")) renderAutoTrader();
}

// ─── Auto-Trader: additional API helpers ─────────────────────────────────────

async function getOrder(id) {
  return ttFetch(`/accounts/${_accountNumber}/orders/${id}`);
}

async function cancelOrder(id) {
  return ttFetch(`/accounts/${_accountNumber}/orders/${id}`, { method: "DELETE" });
}

async function placeRawOrder(order) {
  return ttFetch(`/accounts/${_accountNumber}/orders`, {
    method: "POST",
    body: JSON.stringify(order),
  });
}

function mkStop(symbol, qty, stopPrice, closeAction, tif = "GTC") {
  return {
    "time-in-force": tif,
    "order-type": "Stop",
    "stop-trigger": String(stopPrice),
    "price-effect": closeAction.includes("Sell") ? "Credit" : "Debit",
    "legs": [{ "instrument-type": "Equity", "symbol": symbol, "quantity": qty, "action": closeAction }],
  };
}

function mkLimit(symbol, qty, limitPrice, action, tif = "GTC") {
  return {
    "time-in-force": tif,
    "order-type": "Limit",
    "price": String(limitPrice),
    "price-effect": action.includes("Sell") ? "Credit" : "Debit",
    "legs": [{ "instrument-type": "Equity", "symbol": symbol, "quantity": qty, "action": action }],
  };
}

function mkMarket(symbol, qty, closeAction) {
  return {
    "time-in-force": "Day",
    "order-type": "Market",
    "price-effect": closeAction.includes("Sell") ? "Credit" : "Debit",
    "legs": [{ "instrument-type": "Equity", "symbol": symbol, "quantity": qty, "action": closeAction }],
  };
}

function mkOptionLimit(occSymbol, contracts, limitPrice, action, tif = "Day") {
  const order = {
    "time-in-force": tif,
    "order-type": "Limit",
    "price-effect": action.includes("Buy") ? "Debit" : "Credit",
    "legs": [{ "instrument-type": "Equity Option", "symbol": occSymbol, "quantity": contracts, "action": action }],
  };
  if (limitPrice != null) order["price"] = String(limitPrice);
  return order;
}

function toOCC(symbol, expirationTs, callOrPut, strike) {
  const d    = new Date(expirationTs * 1000);
  const yy   = String(d.getUTCFullYear()).slice(2);
  const mm   = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(d.getUTCDate()).padStart(2, "0");
  const sym  = symbol.toUpperCase().padEnd(6, " ");
  const str  = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${sym}${yy}${mm}${dd}${callOrPut.toUpperCase()}${str}`;
}

function splitQty(total, n) {
  const base = Math.floor(total / n);
  const rem  = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

// ─── Auto-Trader: state ───────────────────────────────────────────────────────

const AT = {
  state:    "idle",   // idle | entry_placed | in_position | closing
  plan:     null,
  symbol:   null,
  style:    null,
  type:     "equity", // "equity" | "option"
  direction: null,    // "long" | "short"

  entryOrderId:   null,
  stopOrderId:    null,
  targetOrderIds: [],

  fillPrice:  null,
  fillQty:    0,
  currentPrice: null,

  occSymbol:        null,
  optionContracts:  0,
  optionStrike:     null,
  optionExpiry:     null,
  optionType:       null,
  entryPremium:     null,

  pollTimer:   null,
  ind:         null,
  optionsFlow: null,
  stopWarned:  false,

  log: [],
};

function atLog(msg, cls = "") {
  const now = new Date().toLocaleTimeString("en-US",
    { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  AT.log.unshift({ time: now, msg, cls });
  if (AT.log.length > 40) AT.log.pop();
  renderAutoTrader();
}

// ─── Auto-Trader: polling ────────────────────────────────────────────────────

function startPoll(delay = 30_000) {
  clearTimeout(AT.pollTimer);
  if (AT.state === "idle") return;
  AT.pollTimer = setTimeout(doPoll, delay);
}

function stopPoll() {
  clearTimeout(AT.pollTimer);
  AT.pollTimer = null;
}

async function doPoll() {
  if (AT.state === "idle") return;
  try {
    if      (AT.state === "entry_placed") await pollEntry();
    else if (AT.state === "in_position")  await pollProtective();
  } catch (e) {
    atLog(`Poll error: ${e.message}`, "bear");
  }
  startPoll();
}

async function pollEntry() {
  if (!AT.entryOrderId) return;
  const data  = await getOrder(AT.entryOrderId);
  const order = data?.data?.order ?? data?.data;
  if (!order) return;

  const status = order.status;
  atLog(`Entry #${AT.entryOrderId}: ${status}`);

  if (status === "Filled" || status === "Partially Filled") {
    const legs  = order.legs ?? [];
    const fills = legs[0]?.fills ?? [];
    AT.fillPrice = fills[0] ? parseFloat(fills[0]["fill-price"]) : (AT.plan?.entry?.hi ?? 0);
    AT.fillQty   = parseInt(order["filled-quantity"]) || AT.plan?.shares || 1;
    await placeBracket();
    AT.state = "in_position";
    atLog(`✓ Filled @ $${f2(AT.fillPrice)} · ${AT.fillQty} ${AT.type === "option" ? "contracts" : "shares"}`, "bull");
  } else if (["Cancelled", "Rejected", "Expired"].includes(status)) {
    AT.state = "idle";
    stopPoll();
    atLog(`✗ Entry ${status.toLowerCase()}.`, "bear");
  }
  renderAutoTrader();
}

async function pollProtective() {
  // Check stop
  if (AT.stopOrderId) {
    const d = await getOrder(AT.stopOrderId).catch(() => null);
    const o = d?.data?.order ?? d?.data;
    if (o?.status === "Filled") {
      atLog("Stop loss filled. Position closed.", "bear");
      for (const id of AT.targetOrderIds) {
        if (id) await cancelOrder(id).catch(() => {});
      }
      resetAT();
      return;
    }
  }

  // Check targets
  for (let i = 0; i < AT.targetOrderIds.length; i++) {
    const id = AT.targetOrderIds[i];
    if (!id) continue;
    const d = await getOrder(id).catch(() => null);
    const o = d?.data?.order ?? d?.data;
    if (o?.status === "Filled") {
      atLog(`✓ Target ${i + 1} filled!`, "bull");
      AT.targetOrderIds[i] = null;
    }
  }

  // All targets done → cancel stop
  if (AT.targetOrderIds.every(id => id === null)) {
    if (AT.stopOrderId) {
      await cancelOrder(AT.stopOrderId).catch(() => {});
      atLog("All targets hit — stop cancelled.", "bull");
    }
    resetAT();
  }
  renderAutoTrader();
}

async function placeBracket() {
  if (AT.type === "equity") {
    const close = AT.direction === "long" ? "Sell to Close" : "Buy to Close";
    const qtys  = splitQty(AT.fillQty, AT.plan.targets.length);

    const stopResult = await placeRawOrder(mkStop(AT.symbol, AT.fillQty, AT.plan.stop, close));
    AT.stopOrderId   = stopResult.data?.order?.id ?? stopResult.data?.id;
    atLog(`Stop placed @ $${f2(AT.plan.stop)} (#${AT.stopOrderId})`);

    AT.targetOrderIds = [];
    for (let i = 0; i < AT.plan.targets.length; i++) {
      const price   = AT.plan.targets[i].price;
      const qty     = qtys[i];
      const tResult = await placeRawOrder(mkLimit(AT.symbol, qty, price, close));
      const tid     = tResult.data?.order?.id ?? tResult.data?.id;
      AT.targetOrderIds.push(tid);
      atLog(`T${i + 1} placed @ $${f2(price)} × ${qty}sh (#${tid})`);
    }
  } else {
    // Options: suggest stop at 50% loss — no native bracket in v1
    AT.entryPremium = AT.fillPrice;
    atLog(`Option in position. Manual stop suggestion: close if premium drops to $${f2(AT.entryPremium * 0.5)}/contract.`);
  }
}

function resetAT() {
  AT.state          = "idle";
  AT.entryOrderId   = null;
  AT.stopOrderId    = null;
  AT.targetOrderIds = [];
  AT.fillPrice      = null;
  AT.fillQty        = 0;
  AT.currentPrice   = null;
  AT.stopWarned     = false;
  stopPoll();
}

// ─── Auto-Trader: arm / disarm / emergency stop ───────────────────────────────

async function armEquity() {
  const plan = AT.plan;
  if (!plan || plan.direction === "flat") return;

  const order = buildOrder();
  try {
    atLog(`Placing entry: ${plan.direction === "long" ? "BUY" : "SELL"} ${plan.shares} ${AT.symbol} @ $${f2(plan.entry.hi)}...`);
    const result       = await placeOrder(order);
    AT.entryOrderId    = result.data?.order?.id ?? result.data?.id;
    AT.type            = "equity";
    AT.direction       = plan.direction;
    AT.state           = "entry_placed";
    AT.stopWarned      = false;
    AT.targetOrderIds  = [];
    atLog(`Entry order #${AT.entryOrderId} live — polling for fill every 30s.`, "bull");
    startPoll(15_000);
    renderAutoTrader();
  } catch (e) {
    atLog(`✗ Failed: ${e.message}`, "bear");
  }
}

function selectOption(flow, plan, price) {
  if (!flow || !plan || plan.direction === "flat" || !price) return null;
  const isBull   = plan.direction === "long";
  const pool     = isBull ? (flow.topCalls ?? []) : (flow.topPuts ?? []);
  if (!pool.length) return null;

  const target = isBull ? price * 1.05 : price * 0.95;
  const best   = pool.reduce((b, o) =>
    !b || Math.abs((o.strike ?? 0) - target) < Math.abs((b.strike ?? 0) - target) ? o : b, null);
  if (!best?.strike || !best?.lastPrice) return null;

  // Parse expiration timestamp from flow.expDate (ISO string "YYYY-MM-DD")
  const expTs = flow.expDate ? new Date(flow.expDate + "T00:00:00Z").getTime() / 1000 : 0;
  const occ   = toOCC(plan.symbol ?? flow.symbol ?? AT.symbol ?? "", expTs, isBull ? "C" : "P", best.strike);

  const dollarRisk  = (plan.accountSize ?? 50_000) * ((plan.riskPct ?? 1) / 100);
  const contracts   = Math.max(1, Math.floor(dollarRisk / (best.lastPrice * 100)));
  return {
    occ, contracts,
    strike:   best.strike,
    expDate:  flow.expDate,
    type:     isBull ? "call" : "put",
    price:    parseFloat(f2(best.lastPrice)),
    totalCost: contracts * best.lastPrice * 100,
  };
}

async function armOption() {
  const plan  = AT.plan;
  const flow  = AT.optionsFlow;
  const price = plan?.entry?.hi ?? 0;
  if (!plan || plan.direction === "flat" || !flow) {
    atLog("No options data — run analysis first.", "bear");
    return;
  }
  const opt = selectOption(flow, plan, price);
  if (!opt) {
    atLog("Could not find suitable option contract from loaded flow.", "bear");
    return;
  }
  const order = mkOptionLimit(opt.occ, opt.contracts, opt.price, "Buy to Open", "Day");
  try {
    atLog(`Placing BTO: ${opt.contracts} × ${AT.symbol} $${opt.strike}${opt.type === "call" ? "C" : "P"} ${opt.expDate} @ $${f2(opt.price)}...`);
    const result       = await placeRawOrder(order);
    AT.entryOrderId    = result.data?.order?.id ?? result.data?.id;
    AT.type            = "option";
    AT.direction       = plan.direction;
    AT.occSymbol       = opt.occ;
    AT.optionContracts = opt.contracts;
    AT.optionStrike    = opt.strike;
    AT.optionExpiry    = opt.expDate;
    AT.optionType      = opt.type;
    AT.state           = "entry_placed";
    AT.stopWarned      = false;
    AT.targetOrderIds  = [];
    atLog(`Option order #${AT.entryOrderId} live — polling for fill.`, "bull");
    startPoll(15_000);
    renderAutoTrader();
  } catch (e) {
    atLog(`✗ Failed: ${e.message}`, "bear");
  }
}

async function disarm() {
  stopPoll();
  if (AT.state === "entry_placed" && AT.entryOrderId) {
    try {
      await cancelOrder(AT.entryOrderId);
      atLog("Entry order cancelled — disarmed.");
    } catch (e) {
      atLog(`Cancel failed: ${e.message}`, "bear");
    }
  }
  resetAT();
  renderAutoTrader();
}

async function emergencyStop() {
  if (AT.state === "idle") return;
  const inPos  = AT.fillQty > 0 && AT.fillPrice;
  const prompt = inPos
    ? "Cancel all bracket orders and close position at MARKET price?"
    : "Cancel pending entry order?";
  if (!confirm(`⚡ Emergency Stop\n\n${prompt}\n\nThis affects your live Tastytrade account.`)) return;

  stopPoll();
  AT.state = "closing";
  atLog("⚡ Emergency stop!", "bear");
  renderAutoTrader();

  // Cancel everything
  const ids = [AT.entryOrderId, AT.stopOrderId, ...AT.targetOrderIds].filter(Boolean);
  for (const id of ids) {
    await cancelOrder(id).catch(() => {});
    atLog(`Cancelled #${id}`);
  }

  // Market close if we were holding a position
  if (inPos) {
    const isOpt      = AT.type === "option";
    const closeAction = AT.direction === "long" ? "Sell to Close" : "Buy to Close";
    const mktOrder   = isOpt
      ? mkOptionLimit(AT.occSymbol, AT.optionContracts, null, closeAction, "Day")
      : mkMarket(AT.symbol, AT.fillQty, closeAction);
    if (isOpt) { mktOrder["order-type"] = "Market"; delete mktOrder.price; }
    try {
      const r = await placeRawOrder(mktOrder);
      atLog(`Market close #${r.data?.order?.id ?? r.data?.id} placed.`, "bull");
    } catch (e) {
      atLog(`✗ Market close failed: ${e.message} — close manually!`, "bear");
    }
  }

  resetAT();
  renderAutoTrader();
}

// ─── Auto-Trader: render ─────────────────────────────────────────────────────

function renderAutoTrader() {
  const panel = el("tt-panel-auto");
  if (!panel) return;

  if (!_session) {
    panel.innerHTML = `<p class="loading">Connect to Tastytrade first.</p>`;
    return;
  }
  if (!_accountNumber) {
    panel.innerHTML = `<p class="loading">Select an account in the Account tab first.</p>`;
    return;
  }

  const state = AT.state;
  const plan  = AT.plan ?? _plan;

  const stateLabel = {
    idle:          ["idle",             ""],
    entry_placed:  ["⏳ waiting fill",   "bull"],
    in_position:   ["● in position",    "bull"],
    closing:       ["closing…",         "bear"],
  }[state] ?? ["idle", ""];

  const logHtml = AT.log.length
    ? AT.log.slice(0, 10).map(e => `
        <div class="at-log-row">
          <span class="at-log-time">${e.time}</span>
          <span class="${e.cls === "bull" ? "pos" : e.cls === "bear" ? "neg" : ""}">${e.msg}</span>
        </div>`).join("")
    : `<div class="at-log-row" style="color:var(--text-faint)">No activity yet.</div>`;

  // ── idle state ─────────────────────────────────────────────────────────────
  if (state === "idle") {
    const hasPlan = plan && plan.direction !== "flat";
    const hasFlow = !!AT.optionsFlow;

    let optPreview = "";
    if (hasPlan && hasFlow) {
      const opt = selectOption(AT.optionsFlow, plan, plan.entry?.hi ?? 0);
      if (opt) {
        const lbl = opt.type === "call" ? "CALL" : "PUT";
        optPreview = `
          <div class="at-opt-preview">
            <span class="opt-type ${opt.type === "call" ? "pos" : "neg"}">${lbl}</span>
            ${_symbol} $${opt.strike} ${opt.type === "call" ? "Call" : "Put"} exp ${opt.expDate}
            · <strong>${opt.contracts} contract${opt.contracts > 1 ? "s" : ""}</strong>
            · $${f2(opt.price)}/contract · <span class="neg">$${f0(opt.totalCost)} risk</span>
          </div>`;
      }
    }

    panel.innerHTML = `
      <div class="at-header">
        <span class="at-label">Auto-Trader</span>
        <span class="pill ${stateLabel[1]}">${stateLabel[0]}</span>
      </div>
      ${!hasPlan ? `<p style="color:var(--text-dim);font-size:13px;margin:0;">No actionable setup — analyze a ticker first.</p>` : `
        <div class="at-trade-card">
          <div class="at-trade-dir ${plan.direction === "long" ? "pos" : "neg"}">
            ${plan.direction === "long" ? "▲ BUY" : "▼ SELL SHORT"} ${_symbol}
          </div>
          <div class="at-trade-meta">
            Entry $${f2(plan.entry?.hi)} · Stop $${f2(plan.stop)} · ${plan.shares} shares
            <span class="pill" style="margin-left:6px;font-size:10px;">${plan.grade} grade · ${Math.round(plan.score)}%</span>
          </div>
          ${optPreview}
        </div>
        <div class="at-arm-row">
          <button id="at-arm-eq" class="primary" style="font-size:12px;">⚡ ARM Equity</button>
          ${hasPlan && hasFlow ? `<button id="at-arm-opt" style="font-size:12px;">ARM Options</button>` : ""}
        </div>
        <div class="at-disclaimer">
          Arming places a <strong>real limit order</strong> on your live account,
          then automatically attaches stop-loss and take-profit brackets once the entry fills.
          Only use capital you can afford to lose entirely.
        </div>
      `}
      <div class="at-log-label">Activity log</div>
      <div class="at-log">${logHtml}</div>`;

    if (hasPlan) {
      el("at-arm-eq")?.addEventListener("click", () => {
        const { shares, entry, stop, targets, direction } = plan;
        if (!confirm(
          `ARM Auto-Trader — Equity\n\n` +
          `${direction === "long" ? "BUY" : "SELL"} ${shares} shares of ${_symbol}\n` +
          `Entry (limit): $${f2(entry.hi)}\n` +
          `Stop-loss (GTC): $${f2(stop)}\n` +
          `Targets (GTC): ${targets.map(t => "$" + f2(t.price)).join(" / ")}\n\n` +
          `This places REAL orders on your live Tastytrade account. Confirm?`
        )) return;
        armEquity();
      });

      el("at-arm-opt")?.addEventListener("click", () => {
        const opt = selectOption(AT.optionsFlow, plan, plan.entry?.hi ?? 0);
        if (!opt) return;
        const typeStr = opt.type === "call" ? "Call" : "Put";
        if (!confirm(
          `ARM Auto-Trader — Options\n\n` +
          `BUY TO OPEN ${opt.contracts} × ${_symbol} $${opt.strike} ${typeStr} exp ${opt.expDate}\n` +
          `Limit: $${f2(opt.price)}/contract · Total: $${f0(opt.totalCost)}\n` +
          `Stop suggestion: close if premium drops 50% ($${f2(opt.price * 0.5)}/contract)\n\n` +
          `This places a REAL order on your live Tastytrade account. Confirm?`
        )) return;
        armOption();
      });
    }
    return;
  }

  // ── entry_placed / in_position / closing ──────────────────────────────────
  const typeStr  = AT.type === "option"
    ? `${AT.optionContracts}c ${AT.symbol} $${AT.optionStrike}${AT.optionType === "call" ? "C" : "P"} ${AT.optionExpiry}`
    : `${AT.fillQty || plan?.shares || "?"} shares of ${AT.symbol}`;
  const dirLabel = AT.direction === "long" ? "▲ LONG" : "▼ SHORT";

  const posRows = state === "in_position" ? `
    <div class="at-pos-grid">
      <div class="at-pos-cell"><div class="at-pos-lbl">Fill</div><div class="at-pos-val">$${f2(AT.fillPrice)}</div></div>
      <div class="at-pos-cell"><div class="at-pos-lbl">Live P&L</div><div class="at-pos-val" id="at-live-pnl">—</div></div>
      <div class="at-pos-cell"><div class="at-pos-lbl">Stop</div><div class="at-pos-val neg">$${f2(plan?.stop)}</div></div>
      ${(plan?.targets ?? []).map((t, i) => `
        <div class="at-pos-cell">
          <div class="at-pos-lbl">T${i + 1}${AT.targetOrderIds[i] == null ? " ✓" : ""}</div>
          <div class="at-pos-val pos">$${f2(t.price)}</div>
        </div>`).join("")}
    </div>` : `<div class="loading" style="margin:8px 0;">Waiting for fill… (polls every 30 s)</div>`;

  panel.innerHTML = `
    <div class="at-header">
      <span class="at-label">Auto-Trader</span>
      <span class="pill ${stateLabel[1]}">${stateLabel[0]}</span>
    </div>
    <div class="at-trade-card">
      <div class="at-trade-dir ${AT.direction === "long" ? "pos" : "neg"}">${dirLabel} · ${typeStr}</div>
      <div class="at-trade-meta">Entry order #${AT.entryOrderId} · acct ${_accountNumber}</div>
    </div>
    ${posRows}
    <div class="at-action-row">
      ${state === "entry_placed" ? `<button id="at-disarm" style="font-size:12px;">✕ Disarm</button>` : ""}
      <button id="at-estop" class="at-estop-btn">⚡ Emergency Stop</button>
    </div>
    <div class="at-log-label">Activity log</div>
    <div class="at-log">${logHtml}</div>`;

  el("at-disarm")?.addEventListener("click", () => {
    if (confirm("Cancel entry order and disarm auto-trader?")) disarm();
  });
  el("at-estop")?.addEventListener("click", emergencyStop);
}

// ─── Auto-Trader: public exports ─────────────────────────────────────────────

export function atPriceTick(tick) {
  if (!tick?.price || AT.state !== "in_position") return;
  AT.currentPrice = tick.price;
  const price = tick.price;
  const stop  = AT.plan?.stop;

  // Near-stop warning (within 1.5% for equity)
  if (stop) {
    const nearStop = AT.direction === "long" ? price < stop * 1.015 : price > stop * 0.985;
    if (nearStop && !AT.stopWarned) {
      AT.stopWarned = true;
      atLog(`⚠ Price $${f2(price)} approaching stop $${f2(stop)}!`, "bear");
    } else if (!nearStop) {
      AT.stopWarned = false;
    }
  }

  // Live P&L — lightweight update, no full re-render
  const pnlEl = document.getElementById("at-live-pnl");
  if (pnlEl && AT.fillPrice && AT.fillQty) {
    const mult  = AT.direction === "long" ? 1 : -1;
    const pnl   = (price - AT.fillPrice) * AT.fillQty * mult;
    const pct   = ((price - AT.fillPrice) / AT.fillPrice) * 100 * mult;
    const cls   = pnl >= 0 ? "pos" : "neg";
    pnlEl.innerHTML =
      `<span class="${cls}">${pnl >= 0 ? "+" : "–"}$${f0(Math.abs(pnl))} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)</span>`;
  }
}

export function atUpdateIndicators(ind) {
  AT.ind = ind;
}

export function atUpdateOptionsFlow(flow) {
  AT.optionsFlow = flow;
}
