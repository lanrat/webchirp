import { BrowserSerialBridge, createSerialRpcHandler } from "./js/serial.js";
import { createRuntimeRpcClient } from "./js/runtime-rpc.js";
import { createUiController } from "./js/ui.js";

const ui = createUiController();
const serialBridge = new BrowserSerialBridge();
const serialRpcHandler = createSerialRpcHandler({
  serialBridge,
  logSerial: ui.logSerial,
});

const rpcClient = createRuntimeRpcClient({
  handleSerialRpc: serialRpcHandler,
  logDebug: ui.logDebug,
  onRuntimeCrash: ui.onRuntimeCrash,
});

ui.setRuntimeApi(rpcClient);

const serialCapability = serialBridge.getCapability();
ui.init(serialCapability.supported);
if (serialCapability.supported && !serialCapability.native && serialCapability.webusb) {
  ui.logSerial(
    "Native Web Serial unavailable; using WebUSB serial polyfill. Only USB CDC-ACM devices are supported this way (vendor-specific CH340/CP2102/PL2303/FTDI cables are not).",
  );
}
