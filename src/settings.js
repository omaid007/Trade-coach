const KEY = "tc_settings_v1";

export const THEMES = {
  ocean: {
    label: "Ocean", preview: "#0b0f17", accent: "#5b9dff",
    vars: {
      "--bg": "#0b0f17", "--bg-elev": "#131a26", "--bg-elev-2": "#1a2332",
      "--border": "#232d3f", "--text": "#e6edf7",
      "--text-dim": "#8a94a6", "--text-faint": "#5a6478",
    },
  },
  midnight: {
    label: "Midnight", preview: "#06080f", accent: "#6aaeff",
    vars: {
      "--bg": "#06080f", "--bg-elev": "#0c1020", "--bg-elev-2": "#10162a",
      "--border": "#1c2640", "--text": "#dde6f8",
      "--text-dim": "#7a86a0", "--text-faint": "#4a5670",
    },
  },
  obsidian: {
    label: "Obsidian", preview: "#000000", accent: "#5b9dff",
    vars: {
      "--bg": "#000000", "--bg-elev": "#0c0c0c", "--bg-elev-2": "#141414",
      "--border": "#222222", "--text": "#e4e4e4",
      "--text-dim": "#888888", "--text-faint": "#555555",
    },
  },
  emerald: {
    label: "Emerald", preview: "#080f0b", accent: "#3fd17a",
    vars: {
      "--bg": "#080f0b", "--bg-elev": "#0f1a14", "--bg-elev-2": "#15221b",
      "--border": "#1e3528", "--text": "#d8f0e4",
      "--text-dim": "#7aaa90", "--text-faint": "#4a7560",
    },
  },
  crimson: {
    label: "Crimson", preview: "#0f0808", accent: "#ff5e6c",
    vars: {
      "--bg": "#0f0808", "--bg-elev": "#1a0f0f", "--bg-elev-2": "#221515",
      "--border": "#3a1e1e", "--text": "#f0dede",
      "--text-dim": "#a08888", "--text-faint": "#705858",
    },
  },
  mono: {
    label: "Black & White", preview: "#080808", accent: "#ffffff",
    vars: {
      "--bg": "#080808", "--bg-elev": "#111111", "--bg-elev-2": "#1c1c1c",
      "--border": "#2e2e2e", "--text": "#ffffff",
      "--text-dim": "#aaaaaa", "--text-faint": "#606060",
      "--green": "#ffffff", "--blue": "#cccccc",
      "--purple": "#aaaaaa", "--amber": "#cccccc",
      "--shadow": "0 4px 16px rgba(0,0,0,0.7)",
    },
  },
  paper: {
    label: "White & Black", preview: "#f4f4f4", accent: "#111111",
    vars: {
      "--bg": "#f0f0f0", "--bg-elev": "#ffffff", "--bg-elev-2": "#e8e8e8",
      "--border": "#d0d0d0", "--text": "#111111",
      "--text-dim": "#555555", "--text-faint": "#999999",
      "--green": "#1a7a40", "--red": "#c0202e",
      "--blue": "#1a55cc", "--purple": "#6633bb",
      "--amber": "#b86a00", "--shadow": "0 4px 16px rgba(0,0,0,0.08)",
    },
  },
};

function defaults() {
  return { theme: "ocean", accountSize: 10000, riskPct: 1, defaultStyle: "swing", defaultSymbol: "AAPL", apiKey: "" };
}

function load() {
  try { return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return defaults(); }
}

function save(s) { localStorage.setItem(KEY, JSON.stringify(s)); }

function mask(key) {
  if (!key) return "";
  return key.slice(0, 14) + "···" + key.slice(-4);
}

export function getApiKey()  { return load().apiKey || ""; }
export function getDefaults() {
  const s = load();
  return { symbol: s.defaultSymbol, style: s.defaultStyle, accountSize: s.accountSize, riskPct: s.riskPct };
}

export function applyStoredTheme() {
  applyTheme(load().theme || "ocean");
}

function applyTheme(name) {
  const t = THEMES[name] || THEMES.ocean;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  document.documentElement.dataset.theme = name;
}

function renderSwatches(activeTheme) {
  const el = document.getElementById("st-themes");
  if (!el) return;
  el.innerHTML = Object.entries(THEMES).map(([id, t]) => `
    <button class="st-swatch${activeTheme === id ? " active" : ""}" data-theme="${id}"
            style="--sw-bg:${t.preview}; --sw-ac:${t.accent};">
      <span class="st-swatch-dot"></span>
      <span class="st-swatch-label">${t.label}</span>
    </button>`).join("");
}

function renderKeyStatus(apiKey) {
  const el = document.getElementById("st-key-status");
  if (!el) return;
  el.textContent = apiKey ? `Active: ${mask(apiKey)}` : "Using key from server/.env (if set)";
  el.className   = "st-key-status " + (apiKey ? "st-key-ok" : "st-key-dim");
}

function renderAll() {
  const s = load();
  renderSwatches(s.theme);
  renderKeyStatus(s.apiKey);

  const el = (id) => document.getElementById(id);
  if (el("st-account")) el("st-account").value = s.accountSize;
  if (el("st-risk"))    el("st-risk").value    = s.riskPct;
  if (el("st-symbol"))  el("st-symbol").value  = s.defaultSymbol;

  document.querySelectorAll(".st-style-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.style === s.defaultStyle));
}

export function initSettings() {
  renderAll();

  // Theme picker
  document.getElementById("st-themes")?.addEventListener("click", e => {
    const btn = e.target.closest(".st-swatch");
    if (!btn) return;
    const theme = btn.dataset.theme;
    applyTheme(theme);
    save({ ...load(), theme });
    renderSwatches(theme);
  });

  // Style buttons
  document.getElementById("st-style-group")?.addEventListener("click", e => {
    const btn = e.target.closest(".st-style-btn");
    if (!btn) return;
    document.querySelectorAll(".st-style-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });

  // Save API key
  document.getElementById("st-save-key")?.addEventListener("click", () => {
    const input = document.getElementById("st-api-key");
    const key   = input?.value.trim();
    if (!key) return;
    save({ ...load(), apiKey: key });
    if (input) input.value = "";
    renderKeyStatus(key);
    const btn = document.getElementById("st-save-key");
    btn.textContent = "✓ Saved";
    setTimeout(() => (btn.textContent = "Save"), 1500);
  });

  // Clear API key
  document.getElementById("st-clear-key")?.addEventListener("click", () => {
    save({ ...load(), apiKey: "" });
    renderKeyStatus("");
  });

  // Save defaults
  document.getElementById("st-save-defaults")?.addEventListener("click", () => {
    const s       = load();
    const style   = document.querySelector(".st-style-btn.active")?.dataset.style ?? s.defaultStyle;
    const account = parseFloat(document.getElementById("st-account")?.value) || s.accountSize;
    const risk    = parseFloat(document.getElementById("st-risk")?.value)    || s.riskPct;
    const symbol  = document.getElementById("st-symbol")?.value.trim().toUpperCase() || s.defaultSymbol;
    save({ ...s, defaultStyle: style, accountSize: account, riskPct: risk, defaultSymbol: symbol });
    const btn = document.getElementById("st-save-defaults");
    btn.textContent = "✓ Saved";
    setTimeout(() => (btn.textContent = "Save defaults"), 1500);
  });
}
