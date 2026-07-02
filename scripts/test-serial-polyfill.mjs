import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserSerialBridge,
  LOOPBACK_TEST_HEX,
  interpretRxDeadStats,
  summarizeLoopback,
} from "../web/js/serial.js";

function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value,
  });
}

test("prefers native Web Serial when available", async () => {
  const nativeSerial = { requestPort: async () => ({}) };
  setNavigator({ serial: nativeSerial, usb: {} });

  const bridge = new BrowserSerialBridge({
    createWebUsbSerial: () => {
      throw new Error("WebUSB provider should not be used when native serial exists");
    },
  });

  assert.deepEqual(bridge.getCapability(), { supported: true, native: true, webusb: true });
  const serial = await bridge._ensureSerial();
  assert.equal(serial, nativeSerial);
  assert.equal(bridge.transport, "webserial");
});

test("falls back to the WebUSB provider when only WebUSB exists", async () => {
  setNavigator({ usb: {} });

  let created = false;
  const webUsbSerial = { requestPort: async () => ({}) };
  const bridge = new BrowserSerialBridge({
    createWebUsbSerial: () => {
      created = true;
      return webUsbSerial;
    },
  });

  assert.deepEqual(bridge.getCapability(), { supported: true, native: false, webusb: true });
  const serial = await bridge._ensureSerial();
  assert.ok(created, "WebUSB provider factory should be invoked");
  assert.equal(serial, webUsbSerial);
  assert.equal(bridge.transport, "webusb");
});

test("forcing webusb uses the WebUSB provider even when native serial exists", async () => {
  // Mirrors Chrome on Android: native Web Serial is present but cannot drive the
  // adapter, so the user explicitly forces the WebUSB transport.
  setNavigator({ serial: { requestPort: async () => ({}) }, usb: {} });

  const webUsbSerial = { requestPort: async () => ({}) };
  const bridge = new BrowserSerialBridge({ createWebUsbSerial: () => webUsbSerial });

  bridge.setPreferredTransport("webusb");
  const serial = await bridge._ensureSerial();
  assert.equal(serial, webUsbSerial);
  assert.equal(bridge.transport, "webusb");
});

test("forcing webserial fails when native serial is unavailable", async () => {
  setNavigator({ usb: {} });
  const bridge = new BrowserSerialBridge({ createWebUsbSerial: () => ({ requestPort: async () => ({}) }) });
  bridge.setPreferredTransport("webserial");
  await assert.rejects(() => bridge._ensureSerial(), /Native Web Serial is not supported/);
});

test("a failed open tears down state instead of leaving a half-open port", async () => {
  setNavigator({ usb: {} });
  const failingPort = {
    open: async () => {
      throw new Error("boom");
    },
    getInfo: () => ({}),
  };
  const bridge = new BrowserSerialBridge({
    createWebUsbSerial: () => ({ requestPort: async () => failingPort }),
  });
  bridge.setPreferredTransport("webusb");

  await assert.rejects(() => bridge.open(9600), /boom/);
  // No half-open port left behind to poison the next connect.
  assert.equal(bridge.port, null);
  assert.equal(bridge.writer, null);
});

test("reports unsupported and refuses to open with no serial transport", async () => {
  setNavigator({});

  const bridge = new BrowserSerialBridge();
  assert.equal(bridge.isSupported(), false);
  assert.deepEqual(bridge.getCapability(), { supported: false, native: false, webusb: false });
  await assert.rejects(() => bridge.open(9600), /Neither Web Serial nor WebUSB/);
});

test("summarizeLoopback: full echo means TX and RX both work", () => {
  const summary = summarizeLoopback(LOOPBACK_TEST_HEX, LOOPBACK_TEST_HEX);
  assert.equal(summary.verdict, "ok");
  assert.match(summary.message, /both work/);
});

test("summarizeLoopback: nothing received means RX is broken (hypothesis A)", () => {
  const summary = summarizeLoopback(LOOPBACK_TEST_HEX, "");
  assert.equal(summary.verdict, "rx-dead");
  assert.match(summary.message, /hypothesis A/);
});

test("summarizeLoopback: corrupted or partial echo is a mismatch", () => {
  const partial = summarizeLoopback(LOOPBACK_TEST_HEX, "55 AA 5A");
  assert.equal(partial.verdict, "mismatch");
  assert.match(partial.message, /received \[55 AA 5A\]/);
  const garbled = summarizeLoopback("55 AA", "AA 55");
  assert.equal(garbled.verdict, "mismatch");
});

test("summarizeLoopback normalizes hex formatting before comparing", () => {
  // Lowercase, comma-separated RX still counts as a clean echo.
  const summary = summarizeLoopback("55 AA", "55,aa");
  assert.equal(summary.verdict, "ok");
});

test("interpretRxDeadStats separates pipe-dead from fifo-empty via the FTDI heartbeat", () => {
  const base = { transport: "webusb" };
  const port = (overrides) => ({
    transfers: 0, stalls: 0, rawBytes: 0, payloadBytes: 0, lastError: "", ...overrides,
  });

  // Non-webusb transports have no raw stats to reason about.
  assert.equal(interpretRxDeadStats({ transport: "webserial", port: null }).cause, "unknown");
  // A recorded transfer error means the read path is dying.
  assert.equal(
    interpretRxDeadStats({ ...base, port: port({ lastError: "boom" }) }).cause,
    "read-error",
  );
  // Zero completed transfers: not even status heartbeats — the pipe is dead.
  assert.equal(interpretRxDeadStats({ ...base, port: port({}) }).cause, "pipe-dead");
  // A couple of transfers that then stop is a wedged read path, not an empty
  // FIFO — the signature of the pull-without-enqueue deadlock.
  assert.equal(
    interpretRxDeadStats({ ...base, port: port({ transfers: 2, rawBytes: 4 }) }).cause,
    "pull-starved",
  );
  // A sustained heartbeat without payload: the read path works, nothing hit
  // the RX FIFO.
  assert.equal(
    interpretRxDeadStats({ ...base, port: port({ transfers: 40, rawBytes: 80 }) }).cause,
    "fifo-empty",
  );
  // Payload seen at USB level but the app never got it.
  assert.equal(
    interpretRxDeadStats({ ...base, port: port({ transfers: 40, rawBytes: 90, payloadBytes: 10 }) }).cause,
    "data-lost",
  );
});
