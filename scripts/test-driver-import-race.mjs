import assert from "node:assert/strict";
import test from "node:test";

import { createCallQueue } from "../web/js/call-queue.mjs";
import { createTestRadioHarness } from "./test-radio-harness.mjs";

// Regression test for the "Duplicate radio driver id" crash: a driver import
// suspends while the lazy import hook fetches module source, and a second
// concurrent import of the same module then re-executes the module body,
// registering every radio class twice. runtime-rpc.js prevents the overlap by
// pushing all Pyodide-backed RPCs through the same call queue used here.
test("serialized concurrent driver imports register each radio exactly once", async () => {
  const harness = await createTestRadioHarness({ repoRoot: process.cwd() });
  const pyodide = harness.pyodide;

  // Delay the source fetch so overlapping imports would reliably interleave
  // during the suspension, as they do with a CDN fetch in the browser.
  const originalFetch = globalThis.fetch_chirp_source;
  globalThis.fetch_chirp_source = async (sourcePath) => {
    const text = await originalFetch(sourcePath);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return text;
  };

  try {
    const enqueue = createCallQueue();
    pyodide.globals.set("_race_module", "hobbypcb");
    const importOnce = () => pyodide.runPythonAsync("ensure_radio_module(_race_module)");

    await Promise.all([enqueue(importOnce), enqueue(importOnce)]);

    const radios = await harness.runPythonJson(
      "json.dumps(list_registered_radios(_modules))",
      { _modules: ["hobbypcb"] },
    );
    const hobbypcb = radios.filter((radio) => radio.vendor === "HobbyPCB");
    assert.equal(hobbypcb.length, 1);
  } finally {
    globalThis.fetch_chirp_source = originalFetch;
  }
});
