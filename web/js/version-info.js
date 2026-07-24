async function loadVersionInfo() {
  const container = document.getElementById("version-info");
  if (!container) return;
  try {
    const response = await fetch("./version.json", { cache: "no-cache" });
    if (!response.ok) return;
    const version = await response.json();

    const dateEl = document.getElementById("version-date");
    if (dateEl && version.lastUpdated) dateEl.textContent = version.lastUpdated;

    const chirpEl = document.getElementById("version-chirp");
    if (chirpEl && version.chirpShaShort) {
      chirpEl.textContent = version.chirpShaShort;
      if (version.chirpCommitUrl) chirpEl.href = version.chirpCommitUrl;
    }

    container.hidden = false;
  } catch {
    // Version info is non-essential; leave hidden on failure.
  }
}

loadVersionInfo();
