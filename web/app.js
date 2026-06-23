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
    "Native Web Serial unavailable; using WebUSB. Supported adapters: FTDI (FT231X/FT232R, etc.) and USB CDC-ACM devices. Other vendor-specific cables (CH340/CP2102/PL2303) are not supported yet.",
  );
}
