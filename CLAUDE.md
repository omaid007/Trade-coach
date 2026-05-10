# Trade Coach — Project Context for Claude Code

A vanilla JS + Vite single-page app that does technical analysis on a stock ticker and outputs a structured trade plan (entry, stop, targets, position sizing) with broker-specific execution instructions. **Educational use only — not investment advice.**

## Run it

```bash
npm install
npm run dev
```

Vite serves at http://localhost:5173 and opens it automatically. There is no backend — the app fetches from Yahoo Finance through public CORS proxies in the browser.

## Architecture at a glance

This is a small client-only app with strict module boundaries. Each module owns one responsibility:

```
index.html              Markup shell. All DOM IDs live here.
src/styles.css          All styling (CSS variables for theming).
src/main.js             Entry point. Holds STATE, wires events, orchestrates the analyze() flow.
src/config.js           Constants: STYLE_CONFIG (day/swing/position), CORS_PROXIES.
src/api.js              fetchOHLC() — Yahoo Finance via CORS proxy. Returns { times, opens, highs, lows, closes, volumes, meta }.
src/indicators.js       Pure math — sma, ema, rsi, macd, bollinger, atr, findSwings, fib. No DOM, no fetch.
src/setups.js           detectSetups(data, indicators, style) — scores 5 setups by confluence, returns ranked array.
src/plan.js             buildPlan(setup, price, accountSize, riskPct) — computes entry mid, stop distance, R-multiple targets, share count.
src/brokers.js          Broker-specific click-path generators (Robinhood, Schwab, Fidelity, IBKR, Webull, E*TRADE, TradingView).
src/format.js           Number/percent formatters used by render.js.
src/render.js           All DOM updates. Each renderX() function paints one section. No business logic here.
```

**Data flow:**

```
user clicks Analyze
  → main.analyze()
    → api.fetchOHLC()
    → indicators.computeAll()
    → setups.detectSetups()
    → plan.buildPlan()
    → render.renderHeader / renderTV / renderIndicators / renderPlan / renderLevels / renderReport / renderExecution
```

State lives in `STATE` in `main.js`. Treat it as the single source of truth — modules return values, `main.js` writes them to STATE, then calls render functions.

## Conventions

- **ES modules only.** All files use `import` / `export`. No CommonJS.
- **Pure functions in `indicators.js`, `setups.js`, `plan.js`.** No DOM access, no `fetch`. Easy to unit-test if/when tests are added.
- **DOM only in `render.js` and `main.js`.** If you need a new render section, add a function to `render.js` and call it from `main.js`.
- **No frameworks, no UI libraries.** Keep dependencies near zero. The only build dep is Vite.
- **CSS variables for color.** Don't hardcode hex values in JS or in new CSS rules — use the variables defined in `:root` in `styles.css`.
- **DOM IDs are the contract** between `index.html` and `render.js`. Don't rename one without the other.

## Adding things — recipes

### New indicator (e.g. Stochastic)

1. Add the pure function to `src/indicators.js` and export it.
2. Call it from `computeAll()` and add the result to the returned `ind` object.
3. Add a row to the `rows` array in `renderIndicators()` in `render.js`.
4. (Optional) Use it inside a setup in `setups.js` to influence scoring.

### New setup (e.g. Inside Bar Breakout)

1. Open `src/setups.js`. Inside `detectSetups()`, push a new object to `setups` with: `key`, `name`, `direction` (`"long"` / `"short"` / `"flat"`), `score`, `entry: { lo, hi, ref }`, `stop`, `targets: [num, num, num]`, `thesis`, `signals: [...]`.
2. Score it from 0–100 based on confluence with other indicators. Higher = more confidence.
3. The highest-scoring setup auto-wins — no other code changes needed.

### New broker

1. Add a case to the `map` in `brokerSteps()` in `src/brokers.js` returning HTML with an `<ol class="steps">`.
2. Add an `<option>` to the `<select id="brokerSelect">` in `index.html`.
3. Add the broker label to `brokerLabel()` in `src/brokers.js`.

### New trading style

1. Add an entry to `STYLE_CONFIG` in `src/config.js` with `range`, `interval`, `atrMult`, `label`, `horizon`.
2. Add a `<button data-style="...">` to the style toggle in `index.html`.
3. Add an entry to `intervalMap` in `renderTV()` in `render.js`.

## Things to know about the data layer

- Yahoo Finance has no official public API; the `query1.finance.yahoo.com/v8/finance/chart/` endpoint works but is undocumented and may change.
- Direct browser calls hit CORS — we route through 3 public proxies (`corsproxy.io`, `allorigins.win`, `codetabs.com`) with fallback. They get rate-limited; that's the most common runtime error.
- If you want to make this production-grade, swap to a paid API (Finnhub, Alpha Vantage, Polygon) and add an `.env` for the API key. Currently no env vars are read.

## Things this app deliberately does NOT do

- **No automated order placement.** It generates click-path instructions only. Don't add code that submits orders to broker APIs without an explicit human-in-the-loop confirmation step.
- **No paid data.** All endpoints used are free-tier or public.
- **No personalized advice.** Output is heuristic-based pattern matching. Always render the disclaimer in `index.html` (see `.disclaimer` block).
- **No persistence.** No localStorage, no backend DB. Refreshing wipes state intentionally.

## Known limitations / good first issues

- Scores in `setups.js` are hand-tuned — there's no backtest validating them. A `src/backtest.js` module that walks historical data and reports win rate per setup would be valuable.
- News feed isn't included in this version (was in earlier prototype). `src/api.js` could grow a `fetchNews(symbols)` function calling Yahoo's `/v1/finance/search` endpoint.
- Symbol search is exact-match. A typeahead using `/v1/finance/search?q=<query>` would be a nice UX upgrade.
- TradingView widget is embedded via iframe — limited styling control. The `tradingview/charting_library` would give more, but it's a paid product.

## When in doubt

- If a feature changes pure logic only → edit `indicators.js` / `setups.js` / `plan.js`.
- If a feature changes what's on screen → edit `render.js` and `index.html`.
- If a feature changes the data source → edit `api.js`.
- Keep `main.js` thin — it should read like a high-level orchestrator.
