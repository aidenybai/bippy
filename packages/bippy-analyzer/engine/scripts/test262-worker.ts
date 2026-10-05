import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { metadataOf } from "./test262-input.js";
import { runTest262Variant } from "./test262-runtime.js";

const [directory, path, mode, expectedHash] = process.argv.slice(2);
if (!directory || !path || !expectedHash || !["strict", "sloppy", "module"].includes(mode))
  throw new Error("Invalid Test262 worker arguments");
const source = readFileSync(resolve(directory, "test", path), "utf8");
const sourceHash = createHash("sha256").update(source).digest("hex");
console.log(
  JSON.stringify({
    sourceHash,
    ...(sourceHash === expectedHash
      ? runTest262Variant(directory, source, metadataOf(source), mode, path)
      : { status: "harness-error", detail: "Test262 source changed during execution" }),
  }),
);
