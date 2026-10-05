import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect, isDeepStrictEqual, promisify } from "node:util";
import { deserialize, serialize } from "node:v8";
import { runProbe, type ProbeResult } from "./probe.js";
import { EngineUnsupportedError as ExperimentUnsupportedError } from "../../src/engine/unsupported.js";

interface WorkerResult {
  kind: "result" | "unsupported" | "error" | "limit";
  result?: ProbeResult;
  reason?: string;
}
interface CorpusEntry {
  file: string;
  status:
    | "matched"
    | "mismatch"
    | "unsupported"
    | "oracle-error"
    | "engine-error"
    | "incomplete"
    | "excluded";
  reason?: string;
  native?: string;
  engine262?: string;
  nativeMs?: number;
  engineMs?: number;
}

const getUnsupported = (error: unknown): string[] =>
  error instanceof ExperimentUnsupportedError
    ? [error.message]
    : error instanceof AggregateError
      ? error.errors.flatMap(getUnsupported)
      : [];
const executable = promisify(execFile);
const script = fileURLToPath(import.meta.url);
const directory = resolve(import.meta.dirname, "../../tests/components");
const seed = Number(process.env.ENGINE262_CORPUS_SEED ?? 1) >>> 0;

if (process.argv[2] === "worker") {
  const backend = process.argv[3];
  if (backend !== "native" && backend !== "engine262") throw new Error("Unknown corpus backend");
  let output: WorkerResult;
  try {
    output = {
      kind: "result",
      result: await runProbe({ backend, filePath: process.argv[4], randomSeed: seed }),
    };
  } catch (error) {
    const unsupported = getUnsupported(error);
    output = {
      kind: unsupported.length ? "unsupported" : "error",
      reason: unsupported.length ? unsupported.join("; ") : String(error),
    };
  }
  await new Promise<void>((resolveWrite) =>
    process.stdout.write(serialize(output).toString("base64"), () => resolveWrite()),
  );
  process.exit(0);
} else {
  const files = (await readdir(directory)).filter((file) => /\.(?:tsx?|jsx?)$/.test(file)).sort();
  const limit = Number(process.argv[2] ?? files.length);
  if (!Number.isInteger(limit) || limit < 0)
    throw new Error("Expected a nonnegative corpus case limit");
  const concurrency = 4;
  const results: CorpusEntry[] = [];
  const queue: string[] = [];
  for (const file of files) {
    if (queue.length >= limit)
      results.push({ file, status: "excluded", reason: "Requested case limit" });
    else queue.push(file);
  }
  const runWorker = async (backend: string, file: string): Promise<WorkerResult> => {
    try {
      const { stdout } = await executable(
        process.execPath,
        [
          "--max-old-space-size=384",
          "--import",
          "tsx",
          script,
          "worker",
          backend,
          resolve(directory, file),
        ],
        { timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 10 * 1024 * 1024, env: process.env },
      );
      return deserialize(Buffer.from(stdout, "base64"));
    } catch (error) {
      return { kind: "limit", reason: String(error).slice(0, 1500) };
    }
  };
  const total = (result: ProbeResult): number =>
    result.prepareMs + result.evaluateMs + result.mountMs;
  const outcome = (result: ProbeResult) => ({
    commits: result.commits,
    trace: result.trace,
    interactions: result.interactions,
    caughtErrors: result.caughtErrors,
  });
  const runCase = async (file: string): Promise<CorpusEntry> => {
    const native = await runWorker("native", file);
    if (native.kind === "unsupported")
      return { file, status: "unsupported", reason: `Native harness: ${native.reason}` };
    if (!native.result || native.result.errors.length)
      return {
        file,
        status: "oracle-error",
        reason: native.reason ?? native.result?.errors.join("; "),
      };
    if (native.result.hasPendingWork)
      return { file, status: "incomplete", reason: "Native controlled queue did not settle" };
    const engine = await runWorker("engine262", file);
    if (engine.kind === "unsupported" || engine.result?.unsupported.length)
      return {
        file,
        status: "unsupported",
        reason: engine.reason ?? engine.result?.unsupported.join("; "),
      };
    if (!engine.result || engine.result.errors.length)
      return {
        file,
        status: "engine-error",
        reason: engine.reason ?? engine.result?.errors.join("; "),
      };
    if (engine.result.hasPendingWork)
      return { file, status: "incomplete", reason: "Engine controlled queue did not settle" };
    const isMatch = isDeepStrictEqual(outcome(native.result), outcome(engine.result));
    return {
      file,
      status: isMatch ? "matched" : "mismatch",
      nativeMs: total(native.result),
      engineMs: total(engine.result),
      ...(!isMatch
        ? {
            native: inspect(outcome(native.result), { depth: null }),
            engine262: inspect(outcome(engine.result), { depth: null }),
          }
        : {}),
    };
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < queue.length) {
        const file = queue[next++];
        const result = await runCase(file);
        results.push(result);
        console.error(
          `${result.status}: ${file}${result.reason ? ` — ${result.reason.slice(0, 160)}` : ""}`,
        );
      }
    }),
  );
  results.sort((left, right) => left.file.localeCompare(right.file));
  console.log(
    JSON.stringify(
      {
        node: process.version,
        seed,
        discovered: files.length,
        attempted: queue.length,
        counts: Object.fromEntries(
          (
            [
              "matched",
              "mismatch",
              "unsupported",
              "oracle-error",
              "engine-error",
              "incomplete",
              "excluded",
            ] satisfies CorpusEntry["status"][]
          ).map((status) => [status, results.filter((entry) => entry.status === status).length]),
        ),
        methodology:
          "One fresh process per case/backend; empty scalar root props; no event actions. Application Math.random, randomUUID and getRandomValues use declared seeded inputs. Fresh Happy DOM windows share a virtual-clock and offline-network policy. No source-text environment exclusions. Native runs first; engine execution is skipped on native failures, unsupported operations or pending work. Ordered host trees, traces, interactions and handled React errors must agree. Worker failures and limits never count as matches. Cold timings are not throughput benchmarks. V8 serialization preserves special scalars.",
        results,
      },
      null,
      2,
    ),
  );
}
