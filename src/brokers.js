import { f2 } from "./format.js";

/** Display name for the broker dropdown labels. */
export function brokerLabel(b) {
  return ({
    generic: "your broker (generic)",
    robinhood: "Robinhood",
    schwab: "Schwab / thinkorswim",
    fidelity: "Fidelity",
    ibkr: "Interactive Brokers",
    webull: "Webull",
    etrade: "E*TRADE",
    tradingview: "TradingView",
  })[b];
}

/**
 * Generate broker-specific click-path HTML for placing the trade.
 *
 * Returns an HTML string with an <ol class="steps">. Add new brokers by
 * appending a new key to the `map` below and an <option> in index.html.
 */
export function brokerSteps(broker, plan, action, orderType, limitPrice, isBreakout, symbol, style) {
  const sym = symbol;
  const qty = plan.shares;
  const entry = f2(limitPrice);
  const stop = f2(plan.stop);
  const trigger = isBreakout ? f2(plan.entry.lo) : entry;
  const t1 = f2(plan.targets[0].price);
  const t2 = f2(plan.targets[1].price);
  const orderTypeUI = orderType === "Stop Limit" ? "Stop Limit" : "Limit";
  const tif = style === "day" ? "DAY" : "GTC";
  const tifFriendly = style === "day" ? "Good for Day" : "Good til Canceled";

  const generic = `
    <ol class="steps">
      <li>Open your broker's order ticket and enter symbol <code>${sym}</code>.</li>
      <li>Choose action: <code>${action}</code>.</li>
      <li>Set order type to <code>${orderTypeUI}</code>${isBreakout ? `, stop trigger <code>$${trigger}</code>` : ""}, limit <code>$${entry}</code>.</li>
      <li>Set quantity to <code>${qty}</code> shares.</li>
      <li>Choose time-in-force: <code>${tif}</code>.</li>
      <li>Attach a <strong>bracket / OCO</strong>: stop-loss at <code>$${stop}</code>, take-profit at <code>$${t2}</code> (or split: ⅓ at $${t1}, ⅓ at $${t2}, ⅓ runner).</li>
      <li>Review and submit. Set price alerts at all three levels in case the bracket disconnects.</li>
    </ol>`;

  const map = {
    generic,
    robinhood: `
    <ol class="steps">
      <li>Open Robinhood, search <code>${sym}</code>.</li>
      <li>Tap <code>Trade → Buy ${sym}</code>.</li>
      <li>Tap the order-type toggle (top right) and choose <code>${orderTypeUI === "Stop Limit" ? "Stop Limit Order" : "Limit Order"}</code>.</li>
      <li>Set limit price <code>$${entry}</code>${isBreakout ? `, stop price <code>$${trigger}</code>` : ""}.</li>
      <li>Enter <code>${qty}</code> shares (or use Dollar Amount if you prefer).</li>
      <li>Time-in-force: <code>${tifFriendly}</code>.</li>
      <li>Submit. Then go back to the symbol page and tap <code>+</code> to set price alerts at $${stop} (stop) and $${t2} (target).</li>
      <li><em>Robinhood doesn't support native bracket/OCO orders — manually place a stop-loss after fill via Sell → Stop Loss Order.</em></li>
    </ol>`,
    schwab: `
    <ol class="steps">
      <li>In thinkorswim or Schwab.com, click <code>Trade → All-in-One Trade Ticket</code>.</li>
      <li>Symbol <code>${sym}</code>, side <code>${action}</code>, quantity <code>${qty}</code>.</li>
      <li>Order type <code>${orderTypeUI}</code>, limit <code>$${entry}</code>${isBreakout ? `, stop <code>$${trigger}</code>` : ""}.</li>
      <li>Click the dropdown next to the order and choose <code>1st Trgs OCO</code> or <code>Bracket</code>.</li>
      <li>Add child orders: SELL stop at <code>$${stop}</code>, SELL limit at <code>$${t2}</code> (or split shares across $${t1}/$${t2}).</li>
      <li>Time-in-force <code>${tif}</code>. Click Confirm and Send.</li>
    </ol>`,
    fidelity: `
    <ol class="steps">
      <li>Active Trader Pro: <code>Trade → Directed Trade Ticket</code>. Web: <code>Trade → Stocks/ETFs</code>.</li>
      <li>Symbol <code>${sym}</code>, action <code>${action}</code>, quantity <code>${qty}</code>.</li>
      <li>Order type <code>${orderTypeUI}</code>, limit price <code>$${entry}</code>${isBreakout ? `, stop <code>$${trigger}</code>` : ""}.</li>
      <li>Conditions: select <code>One-Triggers-OCO (OTO/OCO)</code>.</li>
      <li>Child OCO leg 1 (stop): SELL stop at <code>$${stop}</code>. Leg 2 (target): SELL limit at <code>$${t2}</code>.</li>
      <li>TIF <code>${tif}</code>. Preview and place.</li>
    </ol>`,
    ibkr: `
    <ol class="steps">
      <li>In TWS or IBKR Mobile, type <code>${sym}</code> in the order entry panel.</li>
      <li>Right-click the bid/ask and choose <code>${action}</code>, or use BUY/SELL buttons.</li>
      <li>Order type <code>${orderTypeUI === "Stop Limit" ? "STP LMT" : "LMT"}</code>, quantity <code>${qty}</code>, limit <code>${entry}</code>${isBreakout ? `, stop trigger <code>${trigger}</code>` : ""}.</li>
      <li>Right-click the working order → <code>Attach → Bracket Order</code>.</li>
      <li>Set profit-taker LMT at <code>${t2}</code>, stop-loss STP at <code>${stop}</code>.</li>
      <li>TIF <code>${tif}</code>. Transmit.</li>
    </ol>`,
    webull: `
    <ol class="steps">
      <li>Search <code>${sym}</code>, tap <code>Trade</code>.</li>
      <li>Choose <code>${action === "BUY" ? "Buy" : "Sell"}</code>, then order type <code>${orderTypeUI}</code>.</li>
      <li>Limit price <code>$${entry}</code>${isBreakout ? `, stop <code>$${trigger}</code>` : ""}, quantity <code>${qty}</code>.</li>
      <li>Tap <code>Bracket Order</code> toggle (under the order form).</li>
      <li>Take profit <code>$${t2}</code>, stop loss <code>$${stop}</code>.</li>
      <li>TIF <code>${tif}</code>. Swipe to submit.</li>
    </ol>`,
    etrade: `
    <ol class="steps">
      <li>Power E*TRADE: <code>Trade → Stocks → Conditional</code>. Web: <code>Trading → Stocks</code>.</li>
      <li>Symbol <code>${sym}</code>, action <code>${action}</code>, quantity <code>${qty}</code>.</li>
      <li>Order type <code>${orderTypeUI}</code>, limit <code>$${entry}</code>${isBreakout ? `, stop <code>$${trigger}</code>` : ""}.</li>
      <li>Strategy: <code>Bracket</code> (or <code>One-Cancels-Other</code> after fill).</li>
      <li>Stop <code>$${stop}</code>, Target <code>$${t2}</code>.</li>
      <li>TIF <code>${tif}</code>. Preview → Place Order.</li>
    </ol>`,
    tradingview: `
    <ol class="steps">
      <li>Open the chart on <a href="https://www.tradingview.com/chart/?symbol=${sym}" target="_blank" rel="noopener">tradingview.com</a>.</li>
      <li>Click <code>Trading Panel</code> at the bottom and connect a supported broker (TradeStation, Tradier, OANDA, etc.).</li>
      <li>Right-click the chart at <code>$${entry}</code> → <code>Trade → Buy ${qty} ${sym} @ Limit</code>.</li>
      <li>Drag the order line to fine-tune; right-click the position to add <code>Bracket / Stop Loss / Take Profit</code>.</li>
      <li>Set stop at <code>$${stop}</code>, take-profit at <code>$${t2}</code>.</li>
    </ol>`,
  };

  return map[broker] || generic;
}
