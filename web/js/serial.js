// Parse user-entered hex byte text into a Uint8Array for serial writes.
function parseHex(input) {
  const text = String(input || "").trim();
  if (!text) {
    return new Uint8Array(0);
  }
  const parts = text
    .replace(/[^0-9a-fA-F]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Uint8Array(parts.length);
  for (let i = 0; i < parts.length; i += 1) {
    const value = Number.parseInt(parts[i], 16);
    if (Number.isNaN(value) || value < 0 || value > 255) {
      throw new Error(`Invalid hex byte: ${parts[i]}`);
    }
    out[i] = value;
  }
  return out;
}

// Convert a byte array into uppercase space-delimited hex for display/logging.
function bytesToHex(bytes) {
  return Array.from(bytes || [])
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

// Concatenate two Uint8Array buffers into one contiguous buffer.
function concatUint8(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// Google's Web Serial API polyfill over WebUSB, revision-pinned like the other
// browser-loaded dependencies. It lets browsers that expose WebUSB but not Web
// Serial (e.g. Chrome on Android) drive USB CDC-ACM serial devices. Vendor-
// specific UART bridges (CH340/CP2102/PL2303/FTDI) are NOT USB CDC and will not
// work through it; those still require native Web Serial.
const WEB_SERIAL_POLYFILL_URL =
  "https://cdn.jsdelivr.net/npm/web-serial-polyfill@1.0.15/+esm";

// Lazily import the polyfill only when it is actually needed, so the native Web
// Serial path never depends on the CDN.
async function defaultLoadPolyfill() {
  const mod = await import(WEB_SERIAL_POLYFILL_URL);
  return mod.serial;
}

function hasNativeSerial() {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

function hasWebUsb() {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

// Manage Web Serial lifecycle and provide buffered byte-oriented I/O helpers.
export class BrowserSerialBridge {
  constructor({ loadPolyfill } = {}) {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readBuffer = new Uint8Array(0);
    this.readWaiters = new Set();
    this.lastDeviceName = "";
    // The resolved Web Serial provider (native navigator.serial or the WebUSB
    // polyfill) and which transport it represents, set on first connect.
    this.serial = null;
    this.transport = "";
    this.loadPolyfill = loadPolyfill || defaultLoadPolyfill;
  }

  isSupported() {
    return hasNativeSerial() || hasWebUsb();
  }

  // Report what serial transport(s) this browser can offer.
  getCapability() {
    const native = hasNativeSerial();
    const webusb = hasWebUsb();
    return { supported: native || webusb, native, webusb };
  }

  // Resolve the serial provider: prefer native Web Serial, otherwise fall back
  // to the WebUSB polyfill. Cached after the first call.
  async _ensureSerial() {
    if (this.serial) {
      return this.serial;
    }
    if (hasNativeSerial()) {
      this.serial = navigator.serial;
      this.transport = "webserial";
      return this.serial;
    }
    if (hasWebUsb()) {
      const serial = await this.loadPolyfill();
      if (!serial || typeof serial.requestPort !== "function") {
        throw new Error("WebUSB serial polyfill failed to load.");
      }
      this.serial = serial;
      this.transport = "webusb-polyfill";
      return this.serial;
    }
    throw new Error("Neither Web Serial nor WebUSB is supported in this browser.");
  }

  async open(baudRate) {
    if (this.port) {
      return { connected: true, message: "Already connected." };
    }
    const serial = await this._ensureSerial();

    this.port = await serial.requestPort({});
    await this.port.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
    const identity = this._getPortIdentity(this.port);
    this.lastDeviceName = this._describePort(this.port);
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this._startReadLoop();
    const viaPolyfill = this.transport === "webusb-polyfill";
    return {
      connected: true,
      message: `Connected at ${baudRate} baud${viaPolyfill ? " (WebUSB polyfill)" : ""}`,
      deviceName: this.lastDeviceName,
      usbVendorId: identity.usbVendorId,
      usbProductId: identity.usbProductId,
      transport: this.transport,
    };
  }

  async close() {
    if (!this.port) {
      return { connected: false, message: "No port connected." };
    }

    try {
      await this.reader?.cancel();
    } catch {
      // Ignore cancellation errors.
    }
    try {
      this.reader?.releaseLock();
    } catch {
      // Ignore lock-release errors.
    }
    try {
      this.writer?.releaseLock();
    } catch {
      // Ignore lock-release errors.
    }
    try {
      await this.port.close();
    } catch {
      // Ignore close errors.
    }

    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readBuffer = new Uint8Array(0);
    this._resolveReadWaiters(false);
    return { connected: false, message: "Disconnected." };
  }

  getPortInfo() {
    const identity = this.port ? this._getPortIdentity(this.port) : {};
    return {
      connected: Boolean(this.port),
      deviceName: this.port ? this._describePort(this.port) : this.lastDeviceName,
      usbVendorId: identity.usbVendorId,
      usbProductId: identity.usbProductId,
    };
  }

  async writeHex(hex) {
    if (!this.writer) {
      throw new Error("Port is not connected.");
    }
    const bytes = parseHex(hex);
    await this.writer.write(bytes);
    return { written: bytes.length, hex: bytesToHex(bytes) };
  }

  async writeBytes(bytesLike) {
    if (!this.writer) {
      throw new Error("Port is not connected.");
    }
    const bytes = Uint8Array.from(bytesLike || []);
    await this.writer.write(bytes);
    return { written: bytes.length };
  }

  async readHex(count, timeoutMs) {
    if (!this.port) {
      throw new Error("Port is not connected.");
    }
    const wanted = Math.max(0, Number(count || 0));
    if (wanted === 0) {
      return { read: 0, hex: "", timedOut: false };
    }
    const timeout = Math.max(0, Number(timeoutMs || 0));
    const deadline = performance.now() + timeout;
    while (this.readBuffer.length < wanted) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        break;
      }
      const gotEvent = await this._waitForReadEvent(remaining);
      if (!gotEvent) {
        break;
      }
    }

    const available = Math.min(wanted, this.readBuffer.length);
    const out = this.readBuffer.slice(0, available);
    this.readBuffer = this.readBuffer.slice(available);
    return {
      read: out.length,
      hex: bytesToHex(out),
      timedOut: out.length < wanted,
    };
  }

  async readBytes(count, timeoutMs) {
    const result = await this.readHex(count, timeoutMs);
    const bytes = result.hex
      ? result.hex.split(/\s+/).filter(Boolean).map((part) => Number.parseInt(part, 16))
      : [];
    return bytes;
  }

  async prepareClone(wantsDtr, wantsRts, settleMs) {
    if (!this.port) {
      throw new Error("Port is not connected.");
    }
    this.readBuffer = new Uint8Array(0);
    try {
      await this.port.setSignals({
        dataTerminalReady: Boolean(wantsDtr),
        requestToSend: Boolean(wantsRts),
      });
    } catch {
      // Some adapters/browsers may not support control line changes.
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(settleMs || 0))));
    return { prepared: true };
  }

  async _startReadLoop() {
    while (this.port && this.reader) {
      try {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }
        if (value && value.length > 0) {
          this.readBuffer = concatUint8(this.readBuffer, value);
          this._resolveReadWaiters(true);
        }
      } catch {
        break;
      }
    }
    this._resolveReadWaiters(false);
  }

  _waitForReadEvent(timeoutMs) {
    return new Promise((resolve) => {
      const waiter = {
        settle: (result) => {
          if (!this.readWaiters.delete(waiter)) {
            return;
          }
          clearTimeout(timerId);
          resolve(result);
        },
      };
      const timerId = setTimeout(() => waiter.settle(false), Math.max(0, timeoutMs));
      this.readWaiters.add(waiter);
    });
  }

  _resolveReadWaiters(result) {
    const waiters = Array.from(this.readWaiters);
    for (const waiter of waiters) {
      waiter.settle(result);
    }
  }

  _describePort(port) {
    const identity = this._getPortIdentity(port);
    const vid = identity.usbVendorId;
    const pid = identity.usbProductId;
    if (vid && pid) {
      return `USB VID:PID ${vid}:${pid}`;
    }
    if (vid) {
      return `USB VID ${vid}`;
    }
    return "Unknown (Web Serial API does not expose COM/tty path)";
  }

  _getPortIdentity(port) {
    const info = port?.getInfo?.() || {};
    const usbVendorId = Number.isInteger(info.usbVendorId)
      ? `0x${info.usbVendorId.toString(16).padStart(4, "0").toUpperCase()}`
      : null;
    const usbProductId = Number.isInteger(info.usbProductId)
      ? `0x${info.usbProductId.toString(16).padStart(4, "0").toUpperCase()}`
      : null;
    return { usbVendorId, usbProductId };
  }
}

// Build a serial RPC dispatcher used by runtime bridge messages.
export function createSerialRpcHandler({ serialBridge, logSerial }) {
  async function handleOpen(payload = {}) {
    const res = await serialBridge.open(payload.baudRate);
    logSerial(res.message);
    return res;
  }

  async function handleClose() {
    const res = await serialBridge.close();
    logSerial(res.message);
    return res;
  }

  async function handleWriteHex(payload = {}) {
    const res = await serialBridge.writeHex(payload.hex);
    logSerial(`TX ${res.hex}`);
    return res;
  }

  async function handleReadHex(payload = {}) {
    const res = await serialBridge.readHex(payload.count, payload.timeoutMs);
    logSerial(`RX ${res.hex || "<none>"}${res.timedOut ? " (timeout)" : ""}`);
    return res;
  }

  async function handleWriteBytes(payload = {}) {
    return serialBridge.writeBytes(payload.bytes || []);
  }

  async function handleReadBytes(payload = {}) {
    return serialBridge.readBytes(payload.count, payload.timeoutMs);
  }

  async function handleLog(payload = {}) {
    logSerial(String(payload.message || ""));
    return { logged: true };
  }

  async function handlePrepareClone(payload = {}) {
    const res = await serialBridge.prepareClone(
      payload.wantsDtr,
      payload.wantsRts,
      payload.settleMs,
    );
    logSerial(
      `Prepared clone session (DTR=${Boolean(payload.wantsDtr)} RTS=${Boolean(payload.wantsRts)})`,
    );
    return res;
  }

  async function handleResetBuffers() {
    serialBridge.readBuffer = new Uint8Array(0);
    return { reset: true };
  }

  async function handleGetPortInfo() {
    return serialBridge.getPortInfo();
  }

  const OP_HANDLERS = Object.freeze({
    open: handleOpen,
    close: handleClose,
    writeHex: handleWriteHex,
    readHex: handleReadHex,
    writeBytes: handleWriteBytes,
    readBytes: handleReadBytes,
    log: handleLog,
    prepareClone: handlePrepareClone,
    resetBuffers: handleResetBuffers,
    getPortInfo: handleGetPortInfo,
  });

  return async function handleSerialRpc(msg) {
    const { op, payload } = msg;
    const handler = OP_HANDLERS[op];
    if (!handler) {
      throw new Error(`Unknown serial op: ${op}`);
    }
    return handler(payload || {});
  };
}
