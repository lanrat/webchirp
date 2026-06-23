import assert from "node:assert/strict";
import test from "node:test";
import { BrowserSerialBridge } from "../web/js/serial.js";

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
    loadPolyfill: async () => {
      throw new Error("polyfill should not be loaded when native serial exists");
    },
  });

  assert.deepEqual(bridge.getCapability(), { supported: true, native: true, webusb: true });
  const serial = await bridge._ensureSerial();
  assert.equal(serial, nativeSerial);
  assert.equal(bridge.transport, "webserial");
});

test("falls back to the WebUSB polyfill when only WebUSB exists", async () => {
  setNavigator({ usb: {} });

  let loaded = false;
  const polyfillSerial = { requestPort: async () => ({}) };
  const bridge = new BrowserSerialBridge({
    loadPolyfill: async () => {
      loaded = true;
      return polyfillSerial;
    },
  });

  assert.deepEqual(bridge.getCapability(), { supported: true, native: false, webusb: true });
  const serial = await bridge._ensureSerial();
  assert.ok(loaded, "polyfill loader should be invoked");
  assert.equal(serial, polyfillSerial);
  assert.equal(bridge.transport, "webusb-polyfill");
});

test("reports unsupported and refuses to open with no serial transport", async () => {
  setNavigator({});

  const bridge = new BrowserSerialBridge();
  assert.equal(bridge.isSupported(), false);
  assert.deepEqual(bridge.getCapability(), { supported: false, native: false, webusb: false });
  await assert.rejects(() => bridge.open(9600), /Neither Web Serial nor WebUSB/);
});

test("surfaces a clear error when the polyfill fails to load", async () => {
  setNavigator({ usb: {} });

  const bridge = new BrowserSerialBridge({ loadPolyfill: async () => null });
  await assert.rejects(() => bridge._ensureSerial(), /polyfill failed to load/);
});
