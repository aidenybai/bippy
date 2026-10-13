import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const [format, entry] = process.argv.slice(2);
assert.ok(format === "esm" || format === "cjs");
assert.ok(entry);
const require = createRequire(import.meta.url);
const entryPath = fileURLToPath(entry);
const startTime = performance.now();
if (format === "esm") await import(entry);
else require(entryPath);
console.log((performance.now() - startTime) * 1000);
