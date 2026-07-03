import assert from "node:assert/strict";
import test from "node:test";
import { createSerialRpcHandler } from "../web/js/serial.js";

test("progress op forwards CHIRP status reports to onProgress", async () => {
  const reports = [];
  const handler = createSerialRpcHandler({
    serialBridge: {},
    logSerial: () => {},
    onProgress: (cur, max, msg) => reports.push([cur, max, msg]),
  });

  await handler({ op: "progress", payload: { cur: 42, max: 118, msg: "Cloning from radio" } });
  // Drivers without block counts report -1/-1 (bar stays indeterminate).
  await handler({ op: "progress", payload: { cur: -1, max: -1, msg: "Communicating with radio" } });

  assert.deepEqual(reports, [
    [42, 118, "Cloning from radio"],
    [-1, -1, "Communicating with radio"],
  ]);
});

test("progress op is a no-op without an onProgress sink", async () => {
  const handler = createSerialRpcHandler({ serialBridge: {}, logSerial: () => {} });
  const res = await handler({ op: "progress", payload: { cur: 1, max: 2, msg: "x" } });
  assert.deepEqual(res, { reported: true });
});
