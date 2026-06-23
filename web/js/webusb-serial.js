// A Web Serial-shaped provider (`requestPort`) backed by WebUSB, for browsers
// that expose WebUSB but not Web Serial (e.g. Chrome on Android). A single
// device chooser is shown; the chosen device is then dispatched to a chip
// specific driver:
//   - FTDI adapters (FT231X, FT232R, ...) -> native FTDI-over-WebUSB driver.
//   - Everything else -> Google's web-serial-polyfill, which handles USB
//     CDC-ACM devices and reports a clear error for anything it cannot drive.
import { FtdiSerialPort, isFtdiDevice } from "./ftdi-webusb.js";

const WEB_SERIAL_POLYFILL_URL =
  "https://cdn.jsdelivr.net/npm/web-serial-polyfill@1.0.15/+esm";

// Lazily import the CDC polyfill's SerialPort class only when a non-FTDI device
// is chosen, so the FTDI path never depends on the CDN.
async function defaultLoadCdcSerialPort() {
  const mod = await import(WEB_SERIAL_POLYFILL_URL);
  return mod.SerialPort;
}

export function createWebUsbSerial({ loadCdcSerialPort } = {}) {
  const loadCdc = loadCdcSerialPort || defaultLoadCdcSerialPort;

  return {
    async requestPort() {
      // Empty filters lists all USB devices in the chooser; the chip is
      // identified from the selected device.
      const device = await navigator.usb.requestDevice({ filters: [] });
      if (isFtdiDevice(device)) {
        return new FtdiSerialPort(device);
      }
      const CdcSerialPort = await loadCdc();
      return new CdcSerialPort(device);
    },
  };
}
