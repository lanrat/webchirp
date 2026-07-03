import { BrowserSerialBridge, createSerialRpcHandler } from "./js/serial.js";
import { createRuntimeRpcClient } from "./js/runtime-rpc.js";
import { createUiController } from "./js/ui.js";
import { WEBUSB_SUPPORTED_ADAPTERS, WEBUSB_UNSUPPORTED_ADAPTERS } from "./js/webusb-serial.js";

const ui = createUiController();
const serialBridge = new BrowserSerialBridge();
const serialRpcHandler = createSerialRpcHandler({
  serialBridge,
  logSerial: ui.logSerial,
  onProgress: ui.updateCloneProgress,
});

const rpcClient = createRuntimeRpcClient({
  handleSerialRpc: serialRpcHandler,
  logDebug: ui.logDebug,
  onRuntimeCrash: ui.onRuntimeCrash,
});

ui.setRuntimeApi(rpcClient);

// Read-path diagnostics (loop death, USB stats) go to the serial log.
serialBridge.onDebug = (message) => ui.logSerial(message);

const serialCapability = serialBridge.getCapability();
ui.setSerialController({
  capability: serialCapability,
  setPreferredTransport: (transport) => serialBridge.setPreferredTransport(transport),
});
ui.init(serialCapability.supported);
if (serialCapability.webusb) {
  ui.logSerial(
    "If 'Connect' does not find your USB-serial adapter (e.g. an FTDI or PL2303 cable on Android), "
    + `use 'Connect via WebUSB'. WebUSB supports ${WEBUSB_SUPPORTED_ADAPTERS}; `
    + `other vendor chips (${WEBUSB_UNSUPPORTED_ADAPTERS}) are not supported yet.`,
  );
}
