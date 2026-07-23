import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findCatalogRadioForImageMetadata } from "../web/js/image-metadata.mjs";
import { createTestRadioHarness } from "./test-radio-harness.mjs";

// The registered driver class for a Baofeng UV-5R image; the BaofengUV5R base
// class itself is not directory-registered, so this is what CHIRP detection
// and the radio catalog both use.
const TEST_RADIO = {
  module: "uv5r",
  className: "BaofengUV5RGeneric",
  vendor: "Baofeng",
  model: "UV-5R",
};

const CATALOG = [
  { module: "ft60", className: "FT60Radio", vendor: "Yaesu", model: "FT-60R" },
  { module: "uv5r", className: "BaofengUV5RGeneric", vendor: "Baofeng", model: "UV-5R" },
];

function makeTestRow() {
  return {
    Location: "1",
    Name: "PMR01",
    Frequency: "446.006250",
    Duplex: "",
    Offset: "0.000000",
    Tone: "",
    rToneFreq: "88.5",
    cToneFreq: "88.5",
    DtcsCode: "023",
    DtcsPolarity: "NN",
    RxDtcsCode: "023",
    CrossMode: "Tone->Tone",
    Mode: "NFM",
    TStep: "12.50",
    Skip: "",
    Power: "Low",
    Comment: "image-metadata-test",
  };
}

test("matches catalog radio by metadata driver class name", () => {
  const match = findCatalogRadioForImageMetadata(CATALOG, {
    hasMetadata: true,
    rclass: "BaofengUV5RGeneric",
    vendor: "Baofeng",
    model: "UV-5R",
  });
  assert.equal(match?.module, "uv5r");
  assert.equal(match?.className, "BaofengUV5RGeneric");
});

test("prefers class-name match over vendor/model match", () => {
  const catalog = [
    { module: "other", className: "OtherRadio", vendor: "Baofeng", model: "UV-5R" },
    { module: "uv5r", className: "BaofengUV5RGeneric", vendor: "Baofeng", model: "UV-5R" },
  ];
  const match = findCatalogRadioForImageMetadata(catalog, {
    hasMetadata: true,
    rclass: "BaofengUV5RGeneric",
    vendor: "Baofeng",
    model: "UV-5R",
  });
  assert.equal(match?.module, "uv5r");
});

test("falls back to vendor/model when class name is unknown", () => {
  const match = findCatalogRadioForImageMetadata(CATALOG, {
    hasMetadata: true,
    rclass: "RenamedLegacyClass",
    vendor: "Yaesu",
    model: "FT-60R",
  });
  assert.equal(match?.module, "ft60");
});

test("returns null for missing metadata or unknown radios", () => {
  assert.equal(findCatalogRadioForImageMetadata(CATALOG, { hasMetadata: false }), null);
  assert.equal(findCatalogRadioForImageMetadata(CATALOG, null), null);
  assert.equal(
    findCatalogRadioForImageMetadata(CATALOG, {
      hasMetadata: true,
      rclass: "NopeRadio",
      vendor: "Nope",
      model: "NP-1",
    }),
    null,
  );
  assert.equal(
    findCatalogRadioForImageMetadata(null, {
      hasMetadata: true,
      rclass: "BaofengUV5R",
      vendor: "Baofeng",
      model: "UV-5R",
    }),
    null,
  );
});

test("binary image metadata drives radio model selection", async (t) => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const harness = await createTestRadioHarness({ repoRoot });

  // Build a metadata-tagged image without importing any driver. The payload is
  // deliberately garbage: metadata parsing must not require driver code.
  const craftedImage = await harness.runPythonJson(
    `
_meta_blob = base64.b64encode(json.dumps(json.loads(_meta_json)).encode())
_img = (b"\\x00" * int(_payload_size)) + chirp_common.CloneModeRadio.MAGIC + _meta_blob
json.dumps({"imageBase64": base64.b64encode(_img).decode("ascii")})
    `,
    {
      _meta_json: JSON.stringify({
        rclass: TEST_RADIO.className,
        vendor: TEST_RADIO.vendor,
        model: TEST_RADIO.model,
        variant: "",
      }),
      _payload_size: 0x1808,
    },
  );

  await t.test("reads vendor/model/class from the metadata trailer", async () => {
    const metadata = await harness.runPythonJson(
      "json.dumps(read_image_metadata_base64(_image_b64))",
      { _image_b64: craftedImage.imageBase64 },
    );
    assert.equal(metadata.hasMetadata, true);
    assert.equal(metadata.rclass, TEST_RADIO.className);
    assert.equal(metadata.vendor, TEST_RADIO.vendor);
    assert.equal(metadata.model, TEST_RADIO.model);
  });

  await t.test("applies CHIRP model-compat renames to metadata", async () => {
    const metadata = await harness.runPythonJson(
      `
_meta_blob = base64.b64encode(json.dumps({"rclass": "RT5RRadio", "vendor": "Retevis", "model": "RT-5R"}).encode())
_img = b"\\x00" * 32 + chirp_common.CloneModeRadio.MAGIC + _meta_blob
json.dumps(read_image_metadata_base64(base64.b64encode(_img).decode("ascii")))
      `,
    );
    assert.equal(metadata.hasMetadata, true);
    assert.equal(metadata.vendor, "Retevis");
    assert.equal(metadata.model, "RT5R");
  });

  await t.test("reports images without a metadata trailer", async () => {
    const metadata = await harness.runPythonJson(
      `json.dumps(read_image_metadata_base64(base64.b64encode(b"\\x00" * 64).decode("ascii")))`,
    );
    assert.equal(metadata.hasMetadata, false);
  });

  await t.test("image load fails while the metadata's driver is not imported", async () => {
    // This is the gap the metadata-driven module import closes: CHIRP image
    // detection only sees drivers that are already imported.
    await assert.rejects(
      harness.runPythonJson("json.dumps(load_image_base64(_image_b64))", {
        _image_b64: craftedImage.imageBase64,
      }),
      /Unsupported model/,
    );
  });

  await t.test("metadata selects the driver module to import, then load detects it", async () => {
    // Mirror handleLoadImage: parse metadata, match it against the catalog,
    // import the matched module, then run CHIRP image detection.
    const metadata = await harness.runPythonJson(
      "json.dumps(read_image_metadata_base64(_image_b64))",
      { _image_b64: craftedImage.imageBase64 },
    );
    const match = findCatalogRadioForImageMetadata(CATALOG, metadata);
    assert.equal(match?.module, TEST_RADIO.module);
    await harness.runPythonJson(
      `
ensure_radio_module(_sel_module)
json.dumps({"imported": True})
      `,
      { _sel_module: match.module },
    );

    // Round-trip through a real exported image so the loaded rows are valid.
    const exported = await harness.exportCodeplugBinary(
      TEST_RADIO.module,
      TEST_RADIO.className,
      [makeTestRow()],
    );
    const loaded = await harness.loadCodeplugBinary(exported.image);
    assert.equal(loaded.module, TEST_RADIO.module);
    assert.equal(loaded.className, TEST_RADIO.className);
    assert.equal(loaded.vendor, TEST_RADIO.vendor);
    assert.equal(loaded.model, TEST_RADIO.model);
    const names = (loaded.rows || []).map((row) => String(row.Name || ""));
    assert.ok(names.includes("PMR01"));
  });

  await t.test("image saved by an unregistered base class resolves by vendor/model", async () => {
    // BaofengUV5R is a non-registered base class; an image tagged with it must
    // still match the registered Baofeng UV-5R catalog entry via vendor/model.
    const exported = await harness.exportCodeplugBinary(
      TEST_RADIO.module,
      "BaofengUV5R",
      [makeTestRow()],
    );
    const metadata = await harness.runPythonJson(
      "json.dumps(read_image_metadata_base64(_image_b64))",
      { _image_b64: exported.imageBase64 },
    );
    assert.equal(metadata.rclass, "BaofengUV5R");
    const match = findCatalogRadioForImageMetadata(CATALOG, metadata);
    assert.equal(match?.module, TEST_RADIO.module);
    assert.equal(match?.className, TEST_RADIO.className);

    const loaded = await harness.loadCodeplugBinary(exported.image);
    assert.equal(loaded.module, TEST_RADIO.module);
    assert.equal(loaded.className, TEST_RADIO.className);
  });
});
