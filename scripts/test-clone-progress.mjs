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

// Minimal DOM stand-in for createUiController: every selector resolves to an
// element; the <progress> bar mirrors the real element's value-attribute
// reflection so indeterminate state (no value attribute) is observable.
class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.children = [];
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.innerHTML = "";
  }

  get value() {
    return this.attributes.get("value") ?? "";
  }

  set value(next) {
    this.attributes.set("value", String(next));
  }

  setAttribute(name, val) {
    this.attributes.set(String(name), String(val));
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(String(name));
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
  }

  addEventListener() {}

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelectorAll() {
    return [];
  }

  querySelector() {
    return null;
  }
}

function installFakeDom() {
  const elements = new Map();
  const document = {
    cookie: "",
    querySelector(selector) {
      const key = String(selector);
      if (!elements.has(key)) {
        elements.set(key, new FakeElement());
      }
      return elements.get(key);
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return new FakeElement();
    },
    addEventListener() {},
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { addEventListener() {}, open() {} },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "FakeBrowser/1.0", language: "en-US", appVersion: "FakeBrowser/1.0" },
  });
  return {
    bar: document.querySelector("#clone-progress-bar"),
    label: document.querySelector("#clone-progress-label"),
    percent: document.querySelector("#clone-progress-percent"),
  };
}

test("determinate-to-indeterminate transition clears the stale percentage", async () => {
  const { bar, label, percent } = installFakeDom();
  const { createUiController } = await import("../web/js/ui.js");
  const ui = createUiController();

  // A counted phase renders a determinate bar with a percentage.
  ui.updateCloneProgress(59, 118, "Cloning from radio");
  assert.equal(bar.getAttribute("value"), "50");
  assert.equal(percent.textContent, "50%");
  assert.equal(label.textContent, "Cloning from radio");

  // A no-count phase (-1/-1) must go indeterminate: no value attribute on the
  // <progress> element and no leftover percentage text.
  ui.updateCloneProgress(-1, -1, "Waiting for radio ack");
  assert.equal(bar.hasAttribute("value"), false);
  assert.equal(percent.textContent, "");
  assert.equal(label.textContent, "Waiting for radio ack");

  // A later counted phase becomes determinate again.
  ui.updateCloneProgress(10, 100, "Writing to radio");
  assert.equal(bar.getAttribute("value"), "10");
  assert.equal(percent.textContent, "10%");
});
