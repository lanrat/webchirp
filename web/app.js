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
ui.setSerialController({
  capability: serialCapability,
  setPreferredTransport: (transport) => serialBridge.setPreferredTransport(transport),
});
ui.init(serialCapability.supported);
if (serialCapability.webusb) {
  ui.logSerial(
    "If 'Connect' does not find your USB-serial adapter (e.g. an FTDI cable on Android), use 'Connect via WebUSB'. WebUSB supports FTDI (FT231X/FT232R, etc.) and USB CDC-ACM devices; other vendor chips (CH340/CP2102/PL2303) are not supported yet.",
  );
}
