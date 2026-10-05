import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { TestOutcome, ModuleSource } from "./test262-input.js";

const workerPath = resolve(import.meta.dirname, "test262-worker.ts");
const loaderPath = createRequire(workerPath).resolve("tsx");

const isStatus = (value: unknown): value is TestOutcome["status"] =>
  value === "passed" ||
  value === "failed" ||
  value === "unsupported" ||
  value === "harness-error" ||
  value === "engine-error" ||
  value === "incomplete";

export const runIsolatedTest262Variant = (
  directory: string,
  path: string,
  mode: string,
  sourceHash: string,
  timeoutMs: number,
): TestOutcome => {
  try {
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        loaderPath,
        "--max-old-space-size=384",
        workerPath,
        directory,
        path,
        mode,
        sourceHash,
      ],
      {
        encoding: "utf8",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const result: unknown = JSON.parse(output);
    if (!result || typeof result !== "object") throw new Error("Invalid Test262 worker result");
    if (Reflect.get(result, "sourceHash") !== sourceHash)
      throw new Error("Test262 source changed during execution");
    const status: unknown = Reflect.get(result, "status");
    const detail: unknown = Reflect.get(result, "detail");
    if (!isStatus(status) || (detail !== undefined && typeof detail !== "string"))
      throw new Error("Invalid Test262 worker outcome");
    const unhandledRejections: unknown = Reflect.get(result, "unhandledRejections");
    if (
      unhandledRejections !== undefined &&
      (typeof unhandledRejections !== "number" ||
        !Number.isSafeInteger(unhandledRejections) ||
        unhandledRejections < 0)
    )
      throw new Error("Invalid Test262 rejection count");
    const moduleSources: unknown = Reflect.get(result, "moduleSources");
    const sources: ModuleSource[] = [];
    if (moduleSources !== undefined) {
      if (!Array.isArray(moduleSources)) throw new Error("Invalid Test262 module sources");
      for (const source of moduleSources) {
        if (!source || typeof source !== "object") throw new Error("Invalid Test262 module source");
        const path: unknown = Reflect.get(source, "path");
        const sourceHash: unknown = Reflect.get(source, "sourceHash");
        if (
          typeof path !== "string" ||
          typeof sourceHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(sourceHash)
        )
          throw new Error("Invalid Test262 module source hash");
        sources.push({ path, sourceHash });
      }
    }
    return {
      status,
      ...(sources.length ? { moduleSources: sources } : {}),
      ...(typeof detail === "string" ? { detail } : {}),
      ...(typeof unhandledRejections === "number" ? { unhandledRejections } : {}),
    };
  } catch (error) {
    const code: unknown =
      error && typeof error === "object" ? Reflect.get(error, "code") : undefined;
    const stderr: unknown =
      error && typeof error === "object" ? Reflect.get(error, "stderr") : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const detail =
      code === "ETIMEDOUT"
        ? "Test262 worker deadline exceeded"
        : code === "ENOBUFS"
          ? "Test262 worker output budget exhausted"
          : typeof stderr === "string" &&
              /heap out of memory|Reached heap limit|Allocation failed/i.test(stderr)
            ? "Test262 worker heap budget exhausted"
            : message.slice(0, 4000);
    return {
      status:
        detail.includes("budget exhausted") || code === "ETIMEDOUT"
          ? "incomplete"
          : "harness-error",
      detail,
    };
  }
};
