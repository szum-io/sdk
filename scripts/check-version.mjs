import { readFileSync } from "node:fs";

const { version: pkgVersion } = JSON.parse(readFileSync("package.json", "utf8"));
const src = readFileSync("src/version.ts", "utf8");
const match = src.match(/SDK_VERSION = "([^"]+)"/);
const srcVersion = match?.[1];

if (srcVersion !== pkgVersion) {
  console.error(
    `version drift: package.json is ${pkgVersion}, src/version.ts is ${srcVersion ?? "unparseable"}`,
  );
  console.error("run: node scripts/sync-version.mjs");
  process.exit(1);
}
