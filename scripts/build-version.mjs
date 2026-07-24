import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "web", "version.json");

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

async function main() {
  const lastUpdated = git(["log", "-1", "--format=%cd", "--date=format:%Y-%m-%d"]);
  const chirpSha = git(["-C", "chirp", "rev-parse", "HEAD"]);

  const version = {
    lastUpdated,
    chirpSha,
    chirpShaShort: chirpSha.slice(0, 7),
    chirpCommitUrl: `https://github.com/kk7ds/chirp/commit/${chirpSha}`,
  };

  await writeFile(OUTPUT, `${JSON.stringify(version, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)}:`, version);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
