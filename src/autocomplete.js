import { apiFetch } from "./api.js";

let _dropdown = null;
let _timer = null;
let _inputEl = null;

export function initAutocomplete(inputEl, onSelect) {
  _inputEl = inputEl;

  const wrap = document.createElement("span");
  wrap.style.cssText = "position:relative; display:inline-block;";
  inputEl.parentNode.insertBefore(wrap, inputEl);
  wrap.appendChild(inputEl);
  inputEl.setAttribute("autocomplete", "off");

  inputEl.addEventListener("input", () => {
    clearTimeout(_timer);
    const q = inputEl.value.trim();
    if (q.length < 1) return closeDropdown();
    _timer = setTimeout(() => suggest(q, wrap, onSelect), 220);
  });

  inputEl.addEventListener("keydown", handleKey);

  document.addEventListener("pointerdown", (e) => {
    if (_dropdown && !_dropdown.contains(e.target) && e.target !== inputEl) closeDropdown();
  });
}

async function suggest(q, wrap, onSelect) {
  try {
    const { quotes = [] } = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!quotes.length) { closeDropdown(); return; }
    openDropdown(quotes, wrap, onSelect);
  } catch {
    closeDropdown();
  }
}

function openDropdown(quotes, wrap, onSelect) {
  closeDropdown();
  _dropdown = document.createElement("div");
  _dropdown.className = "ac-dropdown";

  for (const q of quotes) {
    const item = document.createElement("div");
    item.className = "ac-item";
    item.innerHTML = `<b class="ac-sym">${q.symbol}</b><span class="ac-name">${q.name}</span>`;
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      _inputEl.value = q.symbol;
      closeDropdown();
      onSelect(q.symbol);
    });
    _dropdown.appendChild(item);
  }

  wrap.appendChild(_dropdown);
}

function closeDropdown() {
  _dropdown?.remove();
  _dropdown = null;
}

function handleKey(e) {
  if (!_dropdown) return;
  const items = [..._dropdown.querySelectorAll(".ac-item")];
  const hi = _dropdown.querySelector(".ac-hi");
  const idx = items.indexOf(hi);

  if (e.key === "ArrowDown") {
    e.preventDefault();
    const next = idx < items.length - 1 ? idx + 1 : 0;
    items.forEach((el, i) => el.classList.toggle("ac-hi", i === next));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const prev = idx > 0 ? idx - 1 : items.length - 1;
    items.forEach((el, i) => el.classList.toggle("ac-hi", i === prev));
  } else if (e.key === "Enter" && hi) {
    e.preventDefault();
    hi.click();
  } else if (e.key === "Escape") {
    closeDropdown();
  }
}
