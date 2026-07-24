// Match parsed CHIRP image metadata against the radio catalog so the correct
// driver module can be imported before image detection runs. CHIRP's
// directory.get_radio_by_image only searches drivers that are already
// imported, so the caller must resolve module names from metadata up front.
export function findCatalogRadioForImageMetadata(radioCatalog, metadata) {
  if (!metadata?.hasMetadata) {
    return null;
  }
  const catalog = Array.isArray(radioCatalog) ? radioCatalog : [];

  // The metadata rclass is the concrete driver class name, so it is the most
  // precise selector when the class still exists in the catalog.
  const rclass = String(metadata.rclass || "");
  if (rclass) {
    const byClass = catalog.find((radio) => radio.className === rclass);
    if (byClass) {
      return byClass;
    }
  }

  // Fall back to vendor/model identity, which survives driver class renames.
  const vendor = String(metadata.vendor || "");
  const model = String(metadata.model || "");
  if (!vendor || !model) {
    return null;
  }
  return (
    catalog.find((radio) => radio.vendor === vendor && radio.model === model) || null
  );
}
