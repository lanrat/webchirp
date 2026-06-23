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

test("reports unsupported and refuses to open with no serial transport", async () => {
  setNavigator({});

  const bridge = new BrowserSerialBridge();
  assert.equal(bridge.isSupported(), false);
  assert.deepEqual(bridge.getCapability(), { supported: false, native: false, webusb: false });
  await assert.rejects(() => bridge.open(9600), /Neither Web Serial nor WebUSB/);
});
