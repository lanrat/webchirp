import assert from "node:assert/strict";
import test from "node:test";

import { buildExportFileName } from "../web/js/ui.js";

const FIXED_DATE = new Date(2023, 11, 18); // 2023-12-18

test("builds <brand>_<model>_<date>.<format> for binary exports", () => {
  assert.equal(
    buildExportFileName("Baofeng", "BF-888", "img", FIXED_DATE),
    "Baofeng_BF-888_20231218.img",
  );
});

test("builds <brand>_<model>_<date>.<format> for CSV exports", () => {
  assert.equal(
    buildExportFileName("Yaesu", "FT-60", "csv", FIXED_DATE),
    "Yaesu_FT-60_20231218.csv",
  );
});

test("zero-pads single-digit month and day", () => {
  assert.equal(
    buildExportFileName("Baofeng", "UV-5R", "img", new Date(2024, 0, 5)),
    "Baofeng_UV-5R_20240105.img",
  );
});

test("sanitizes characters that are unsafe in file names", () => {
  assert.equal(
    buildExportFileName("Radioddity & Co", "GA-510 (v2)", "img", FIXED_DATE),
    "Radioddity_Co_GA-510_v2_20231218.img",
  );
});

test("falls back to 'radio' for empty vendor or model", () => {
  assert.equal(
    buildExportFileName("", null, "csv", FIXED_DATE),
    "radio_radio_20231218.csv",
  );
});
