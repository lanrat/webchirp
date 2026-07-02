import assert from "node:assert/strict";
import test from "node:test";
import {
  FTDI_VENDOR_ID,
  FtdiSerialPort,
  ftdiConvertBaudrate,
  isFtdiDevice,
  stripFtdiStatusBytes,
} from "../web/js/ftdi-webusb.js";
import { createWebUsbSerial } from "../web/js/webusb-serial.js";

function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value });
}

test("ftdiConvertBaudrate matches known libftdi divisor encodings", () => {
  // Well-known FTDI (FT232R/FT-X, 3 MHz clock) divisor values.
  assert.deepEqual(ftdiConvertBaudrate(9600), { value: 0x4138, index: 0 });
  assert.deepEqual(ftdiConvertBaudrate(115200), { value: 0x001a, index: 0 });
  assert.deepEqual(ftdiConvertBaudrate(3000000), { value: 0, index: 0 });
  assert.throws(() => ftdiConvertBaudrate(0), /Invalid FTDI baud rate/);
});

test("stripFtdiStatusBytes drops the two-byte modem status header", () => {
  assert.deepEqual(
    Array.from(stripFtdiStatusBytes(new Uint8Array([0x01, 0x60, 0xaa, 0xbb]))),
    [0xaa, 0xbb],
  );
  // A packet carrying only the status header yields no payload.
  assert.equal(stripFtdiStatusBytes(new Uint8Array([0x01, 0x60])).length, 0);
  assert.equal(stripFtdiStatusBytes(new Uint8Array([])).length, 0);
});

test("isFtdiDevice recognizes the FTDI vendor id", () => {
  assert.equal(FTDI_VENDOR_ID, 0x0403);
  assert.ok(isFtdiDevice({ vendorId: 0x0403, productId: 0x6015 }));
  assert.ok(!isFtdiDevice({ vendorId: 0x067b, productId: 0x2303 })); // PL2303
  assert.ok(!isFtdiDevice(null));
});

test("WebUSB provider dispatches FTDI devices to the FTDI driver", async () => {
  let requestedOptions = null;
  setNavigator({
    usb: {
      requestDevice: async (options) => {
        requestedOptions = options;
        return { vendorId: 0x0403, productId: 0x6015 };
      },
    },
  });
  const serial = createWebUsbSerial({
    loadCdcSerialPort: async () => {
      throw new Error("CDC polyfill should not load for FTDI devices");
    },
  });
  const port = await serial.requestPort();
  assert.ok(port instanceof FtdiSerialPort);
  assert.deepEqual(port.getInfo(), { usbVendorId: 0x0403, usbProductId: 0x6015 });
  // The chooser must filter on the FTDI vendor id, or the device is never shown.
  assert.ok(
    requestedOptions?.filters?.some((f) => f.vendorId === FTDI_VENDOR_ID),
    "requestDevice must be called with an FTDI vendor filter",
  );
});

test("WebUSB provider dispatches non-FTDI devices to the CDC polyfill", async () => {
  setNavigator({
    usb: { requestDevice: async () => ({ vendorId: 0x067b, productId: 0x2303 }) },
  });
  let loaded = false;
  class FakeCdcPort {
    constructor(device) {
      this.device = device;
    }
  }
  const serial = createWebUsbSerial({
    loadCdcSerialPort: async () => {
      loaded = true;
      return FakeCdcPort;
    },
  });
  const port = await serial.requestPort();
  assert.ok(loaded, "CDC polyfill loader should be invoked for non-FTDI devices");
  assert.ok(port instanceof FakeCdcPort);
});

test("FtdiSerialPort.open() purges FIFOs and sets the latency timer", async () => {
  const controlCalls = [];
  const fakeDevice = {
    vendorId: 0x0403,
    productId: 0x6015,
    configuration: {
      interfaces: [
        {
          interfaceNumber: 0,
          alternate: {
            endpoints: [
              { direction: "in", endpointNumber: 1, packetSize: 64 },
              { direction: "out", endpointNumber: 2 },
            ],
          },
        },
      ],
    },
    open: async () => {},
    claimInterface: async () => {},
    controlTransferOut: async ({ request, value, index }) => {
      controlCalls.push({ request, value, index });
      return { status: "ok" };
    },
  };

  const port = new FtdiSerialPort(fakeDevice);
  await port.open({ baudRate: 9600 });

  // Init sequence faithful to native drivers: reset, purge RX, purge TX,
  // baud, framing, flow control, latency timer.
  assert.deepEqual(controlCalls, [
    { request: 0x00, value: 0x0000, index: 1 }, // SIO_RESET
    { request: 0x00, value: 0x0001, index: 1 }, // purge RX FIFO
    { request: 0x00, value: 0x0002, index: 1 }, // purge TX FIFO
    { request: 0x03, value: 0x4138, index: 0 }, // 9600 baud divisor
    { request: 0x04, value: 0x0008, index: 1 }, // 8N1
    { request: 0x02, value: 0x0000, index: 1 }, // no flow control
    { request: 0x09, value: 4, index: 1 }, // latency timer 4 ms
  ]);
  assert.ok(port.readable, "readable stream must be set up");
  assert.ok(port.writable, "writable stream must be set up");
});
