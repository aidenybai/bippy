import { writeFileSync } from "node:fs";
import { captureBrowserSnapshot, formatRuntimeSnapshot } from "../src/harness/index.js";

const [, , url, outputPath] = process.argv;
if (!url) {
  console.error("usage: tsx scripts/capture.ts <url> [snapshot.json]");
  process.exit(1);
}

const capture = await captureBrowserSnapshot({
  url,
  settleMs: 3_000,
  onConsole: (type, text) => {
    if (type === "error") console.error(`[page] ${text}`);
  },
});
console.log(
  `react ${capture.snapshot.reactVersion} (${capture.snapshot.rendererName}, ${capture.snapshot.buildType}); ${capture.commits} commits; ${capture.snapshot.roots.length} roots`,
);
for (const error of capture.pageErrors) console.error(`[pageerror] ${error}`);
for (const root of capture.snapshot.roots) console.log(formatRuntimeSnapshot(root));
if (outputPath) writeFileSync(outputPath, JSON.stringify(capture.snapshot, null, 2));
