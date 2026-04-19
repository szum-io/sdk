import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

writeFileSync("src/version.ts", `export const SDK_VERSION = "${version}";\n`);

console.log(`synced src/version.ts to ${version}`);
