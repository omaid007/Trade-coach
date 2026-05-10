/**
 * Yahoo Finance WebSocket — real-time price ticks via our Express proxy.
 *
 * Messages arrive as base64-encoded protobuf (yaticker schema).
 *
 * Proto schema (relevant fields only):
 *   1  string id
 *   2  float  price
 *   3  sint64 time          — ms epoch, zigzag-encoded
 *   8  float  changePercent — fraction (0.015 = 1.5%)
 *   9  sint64 dayVolume
 *  10  float  dayHigh
 *  11  float  dayLow
 *  12  float  change
 *  15  float  openPrice
 *  16  float  previousClose
 */

function decodeYaTicker(b64) {
  const bin = atob(b64.trim());
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const view = new DataView(buf.buffer);

  let pos = 0;
  const out = {};

  const varint = () => {
    let v = 0, shift = 0;
    while (pos < buf.length) {
      const b = buf[pos++];
      v += (b & 0x7F) * 2 ** shift;
      shift += 7;
      if (!(b & 0x80)) break;
    }
    return v;
  };

  const zz = (n) => n % 2 === 0 ? n / 2 : -(n + 1) / 2;

  while (pos < buf.length) {
    const tag   = varint();
    const field = tag >>> 3;
    const wire  = tag & 7;

    if (wire === 0) {
      const v = varint();
      if (field === 3)  out.time      = zz(v);
      if (field === 7)  out.marketHours = v;
      if (field === 9)  out.dayVolume = v;
    } else if (wire === 2) {
      const len = varint();
      const bytes = buf.slice(pos, pos + len);
      pos += len;
      const s = new TextDecoder().decode(bytes);
      if (field === 1)  out.id        = s;
      if (field === 4)  out.currency  = s;
      if (field === 5)  out.exchange  = s;
      if (field === 13) out.shortName = s;
    } else if (wire === 5) {
      const f = view.getFloat32(pos, true);
      pos += 4;
      if (field === 2)  out.price         = f;
      if (field === 8)  out.changePercent = f;
      if (field === 10) out.dayHigh       = f;
      if (field === 11) out.dayLow        = f;
      if (field === 12) out.change        = f;
      if (field === 15) out.openPrice     = f;
      if (field === 16) out.prevClose     = f;
    } else if (wire === 1) {
      pos += 8;
    } else {
      break;
    }
  }

  return out;
}

let _ws             = null;
let _symbol         = null;
let _onTick         = null;
let _reconnectTimer = null;

function connect(symbol) {
  clearTimeout(_reconnectTimer);
  if (_ws) { _ws.onclose = null; _ws.close(); _ws = null; }

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  _ws = new WebSocket(`${proto}//${location.host}/ws`);

  _ws.onopen = () => _ws.send(JSON.stringify({ subscribe: [symbol] }));

  _ws.onmessage = ({ data }) => {
    try {
      const tick = decodeYaTicker(data);
      if (tick.price > 0 && _onTick) _onTick(tick);
    } catch {}
  };

  _ws.onerror = () => {};

  _ws.onclose = () => {
    if (_symbol) _reconnectTimer = setTimeout(() => connect(_symbol), 5000);
  };
}

export function startStream(symbol, onTick) {
  _symbol = symbol;
  _onTick = onTick;
  connect(symbol);
}

export function stopStream() {
  _symbol = null;
  _onTick = null;
  clearTimeout(_reconnectTimer);
  if (_ws) { _ws.onclose = null; _ws.close(); _ws = null; }
}
