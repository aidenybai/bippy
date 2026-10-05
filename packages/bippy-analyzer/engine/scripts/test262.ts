import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defaultScopes,
  getTestModes,
  getUnsupportedReason,
  metadataOf,
  parseTest262Options,
  selectTest262Files,
  test262Revision,
  test262JobLimit,
  test262ModuleLimit,
  test262ModuleByteLimit,
  type TestResult,
} from "./test262-input.js";
import { runIsolatedTest262Variant } from "./test262-process.js";

if (process.argv.includes("--help")) {
  console.log(
    "Usage: test:engine:test262 CHECKOUT [--scope PATH ... | --all] [--shard INDEX/TOTAL] [--timeout MILLISECONDS] [--list]\nDefaults: regression scopes plus tail calls; 60000ms per variant. --scope selects a file or recursive directory. Shards are one-based, stable path hashes. --list does not execute tests.",
  );
} else {
  const options = parseTest262Options(process.argv.slice(2));
  const directory = resolve(options.directory);
  const git = (...arguments_: string[]): string =>
    execFileSync("git", ["-C", directory, ...arguments_], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  if (git("rev-parse", "HEAD") !== test262Revision)
    throw new Error(`Test262 must be checked out at ${test262Revision}`);
  if (git("status", "--porcelain", "--", "test", "harness"))
    throw new Error("Test262 test/harness files must be clean");
  const paths = git("ls-tree", "-rz", "--name-only", "HEAD", "test")
    .split("\0")
    .filter(Boolean)
    .map((path) => path.slice("test/".length));
  const { files, ...accounting } = selectTest262Files(paths, options);
  if (!accounting.matchingFiles) throw new Error("Test262 selection matches no test files");
  const selection = {
    preset: options.all ? "all" : options.scopes.length ? "scopes" : "regression",
    scopes: options.scopes.length ? options.scopes : options.all ? [] : defaultScopes,
    recursive: options.scopes.length > 0 || options.all,
    patterns: options.scopes.length || options.all ? [] : ["**/tco.js", "**/tco-*.js"],
    shard: options.shard,
  };
  const report = { revision: test262Revision, selection, ...accounting, files: files.length };
  if (options.list)
    console.log(JSON.stringify({ kind: "selection", ...report, paths: files }, null, 2));
  else {
    if (!files.length) throw new Error("Selected Test262 shard is empty");
    const bundle = new URL(import.meta.resolve("#engine"));
    const hashBundle = (): string =>
      createHash("sha256").update(readFileSync(bundle)).digest("hex");
    const bundleHash = hashBundle();
    const hashRunner = (): string =>
      createHash("sha256")
        .update(
          JSON.stringify(
            [
              "test262.ts",
              "test262-input.ts",
              "test262-runtime.ts",
              "test262-process.ts",
              "test262-worker.ts",
              "test262-modules.ts",
            ].map((name) => [name, readFileSync(resolve(import.meta.dirname, name), "utf8")]),
          ),
        )
        .digest("hex");
    const runnerHash = hashRunner();
    const results: TestResult[] = [];
    const recordResult = (result: TestResult): void => {
      results.push(result);
      process.stderr.write(`${JSON.stringify({ kind: "result", ...result })}\n`);
    };
    for (const path of files) {
      const source = readFileSync(resolve(directory, "test", path), "utf8");
      const sourceHash = createHash("sha256").update(source).digest("hex");
      try {
        const metadata = metadataOf(source);
        const unsupported = getUnsupportedReason(path, metadata);
        if (unsupported) {
          recordResult({
            path,
            sourceHash,
            mode: "not-run",
            status: "unsupported",
            detail: unsupported,
          });
          continue;
        }
        for (const mode of getTestModes(metadata)) {
          process.stderr.write(`${JSON.stringify({ kind: "start", path, mode })}\n`);
          recordResult({
            path,
            sourceHash,
            mode,
            ...runIsolatedTest262Variant(directory, path, mode, sourceHash, options.timeoutMs),
          });
        }
      } catch (error) {
        recordResult({
          path,
          sourceHash,
          mode: "metadata",
          status: "harness-error",
          detail: String(error),
        });
      }
    }
    const counts = {
      passed: 0,
      failed: 0,
      unsupported: 0,
      "harness-error": 0,
      "engine-error": 0,
      incomplete: 0,
    };
    for (const result of results) counts[result.status]++;
    const engineChanged = hashBundle() !== bundleHash;
    const runnerChanged = hashRunner() !== runnerHash;
    const checkoutChanged = git("status", "--porcelain", "--", "test", "harness") !== "";
    console.log(
      JSON.stringify(
        {
          kind: "execution",
          ...report,
          bundleHash,
          runnerHash,
          node: process.version,
          engineChanged,
          runnerChanged,
          checkoutChanged,
          limits: {
            timeoutMs: options.timeoutMs,
            nodes: 2_000_000,
            jobs: test262JobLimit,
            modules: test262ModuleLimit,
            moduleSourceBytes: test262ModuleByteLimit,
            workerOldSpaceMiB: 384,
            workerOutputBytes: 1024 * 1024,
          },
          variants: results.filter((result) => ["strict", "sloppy", "module"].includes(result.mode))
            .length,
          counts,
          unhandledRejections: results.reduce(
            (total, result) => total + (result.unhandledRejections ?? 0),
            0,
          ),
          results,
        },
        null,
        2,
      ),
    );
    if (
      engineChanged ||
      runnerChanged ||
      checkoutChanged ||
      Object.entries(counts).some(([status, count]) => status !== "passed" && count > 0)
    )
      process.exitCode = 1;
  }
}
