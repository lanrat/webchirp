// Copy the currently-deployed generation of content-hashed assets into a
// freshly built dist/. GitHub Pages serves everything with a fixed
// `Cache-Control: max-age=600` and no header control, so for up to 10 minutes
// after a deploy a cached index.html can still reference the previous build's
// hashed asset names; without retention those names 404 and the app breaks
// until the cache expires. Hashed names are immutable (name == content), so
// carrying the old files forward is always safe.
//
// Usage: node scripts/retain-deployed-assets.mjs <deployed-site-base-url>
// Run in CI after `npm run build:dist`, before uploading the Pages artifact.
// Exits 0 (with a warning) when the deployed site is unreachable — e.g. the
// first ever deploy — so it never blocks a release.

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const DIST_DIR = path.join(process.cwd(), "dist");
const RETAINED_LIST = "retained-assets.json";
// Keep prior generations well past the 10-minute Pages cache window; cheap
// insurance for edge caches and long-lived tabs that lazy-load modules.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// A hashed asset looks like name.<10 hex chars>.ext (see build-dist.mjs).
const HASHED_NAME_RE = /\.([0-9a-f]{10})\.[a-z]+$/;

function normalizeAssetPath(ref) {
  // Manifest values appear as both "./js/ui.<hash>.js" and "/js/ui.<hash>.js".
  return ref.replace(/^\.?\//, "");
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const baseUrl = (process.argv[2] || "").replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("Usage: retain-deployed-assets.mjs <deployed-site-base-url>");
  }
  if (!existsSync(DIST_DIR)) {
    throw new Error("dist/ not found; run `npm run build:dist` first.");
  }

  const manifest = await fetchJson(`${baseUrl}/asset-manifest.json`);
  if (!manifest?.assets) {
    console.warn(`No deployed asset manifest at ${baseUrl}; nothing to retain (first deploy?).`);
    return;
  }
  // The deployed site's own retained list chains retention across deploys that
  // land closer together than the cache window.
  const previousRetained = (await fetchJson(`${baseUrl}/${RETAINED_LIST}`)) || {};

  const now = Date.now();
  const candidates = new Map(); // asset path -> firstSeen ISO timestamp
  for (const ref of Object.values(manifest.assets)) {
    candidates.set(normalizeAssetPath(ref), new Date(now).toISOString());
  }
  for (const [assetPath, firstSeen] of Object.entries(previousRetained)) {
    const age = now - Date.parse(firstSeen);
    if (Number.isFinite(age) && age <= MAX_AGE_MS) {
      candidates.set(assetPath, firstSeen);
    }
  }

  const retained = {};
  for (const [assetPath, firstSeen] of candidates) {
    const hashMatch = path.basename(assetPath).match(HASHED_NAME_RE);
    if (!hashMatch) {
      continue; // only content-hashed files are safe to carry forward
    }
    const target = path.join(DIST_DIR, assetPath);
    if (!path.resolve(target).startsWith(path.resolve(DIST_DIR) + path.sep)) {
      continue; // ignore traversal attempts from a hostile manifest
    }
    if (existsSync(target)) {
      continue; // current build already provides this exact content
    }
    const res = await fetch(`${baseUrl}/${assetPath}`, { redirect: "follow" });
    if (!res.ok) {
      console.warn(`Skipping ${assetPath}: deployed site returned ${res.status}`);
      continue;
    }
    const body = Buffer.from(await res.arrayBuffer());
    // Note: the filename hash cannot be re-verified against the content —
    // build-dist.mjs hashes files BEFORE rewriting asset references inside
    // them, so the served bytes intentionally differ from the name's digest.
    // The res.ok check above is the integrity gate; Pages returns real 404s
    // (no SPA fallback), so a miss can't smuggle an error page in here.
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    retained[assetPath] = firstSeen;
    console.log(`Retained ${assetPath}`);
  }

  await writeFile(
    path.join(DIST_DIR, RETAINED_LIST),
    `${JSON.stringify(retained, null, 2)}\n`,
    "utf8",
  );
  console.log(`Retained ${Object.keys(retained).length} previous-generation asset(s).`);
}

await main();
