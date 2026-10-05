import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inspect, isDeepStrictEqual, promisify } from "node:util";
import { deserialize, serialize } from "node:v8";
import { StaticRenderer } from "../render/static-renderer.js";
import { EngineLimitError, EngineUnsupportedError } from "../engine/unsupported.js";
import {
  renderNativeEngineWitness,
  type EngineCorpusObservation,
} from "./native-engine-renderer.js";

interface WorkerResult {
  status: "complete" | "failed" | "unsupported" | "incomplete";
  observation?: EngineCorpusObservation;
  detail?: string;
}

interface CorpusResult {
  file: string;
  bundleHash?: string;
  status:
    | "matched"
    | "mismatch"
    | "unsupported"
    | "oracle-error"
    | "engine-error"
    | "harness-error"
    | "incomplete";
  detail?: string;
  native?: string;
  engine?: string;
}

const script = resolve(import.meta.dirname, "engine-port.ts");
const directory = resolve(import.meta.dirname, "../../tests/components");
const executable = promisify(execFile);

if (process.argv[2] === "worker") {
  const backend = process.argv[3];
  const filePath = process.argv[4];
  let output: WorkerResult;
  try {
    if (backend === "native") {
      const observation = await renderNativeEngineWitness(filePath);
      output = {
        status: observation.errors.length ? "failed" : "complete",
        observation,
        detail: observation.errors.join("; "),
      };
    } else if (backend === "engine") {
      const renderer = new StaticRenderer({
        rootDirectory: dirname(filePath),
        execution: "engine",
      });
      const result = await renderer.renderComponent(filePath);
      output = {
        status: result.engine?.status ?? "failed",
        observation: {
          bundleHash: result.engine?.bundleHash,
          commits: result.commits,
          errors: result.diagnostics.map((diagnostic) => diagnostic.message),
        },
        detail: result.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
      };
    } else throw new Error("Unknown engine corpus backend");
  } catch (error) {
    output = {
      status:
        error instanceof EngineUnsupportedError
          ? "unsupported"
          : error instanceof EngineLimitError
            ? "incomplete"
            : "failed",
      detail: String(error),
    };
  }
  await new Promise<void>((finish) =>
    process.stdout.write(serialize(output).toString("base64"), () => finish()),
  );
  process.exit(0);
} else {
  const files = (await readdir(directory)).filter((file) => /\.(?:tsx?|jsx?)$/.test(file)).sort();
  const limit = Number(process.argv[2] ?? files.length);
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Expected a positive corpus limit");
  const selected = files.slice(0, limit);
  const runWorker = async (backend: string, file: string): Promise<WorkerResult> => {
    try {
      const { stdout } = await executable(
        process.execPath,
        [
          "--max-old-space-size=512",
          "--import",
          "tsx",
          script,
          "worker",
          backend,
          resolve(directory, file),
        ],
        { timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 10 * 1024 * 1024 },
      );
      return deserialize(Buffer.from(stdout, "base64"));
    } catch (error) {
      const isLimit =
        error &&
        typeof error === "object" &&
        (Reflect.get(error, "killed") ||
          Reflect.get(error, "signal") === "SIGKILL" ||
          /heap out of memory|maxBuffer/.test(String(Reflect.get(error, "stderr"))));
      return { status: isLimit ? "incomplete" : "failed", detail: String(error).slice(0, 1600) };
    }
  };
  const compare = async (file: string): Promise<CorpusResult> => {
    const native = await runWorker("native", file);
    if (native.status === "unsupported" || native.status === "incomplete")
      return { file, status: native.status, detail: `Native witness: ${native.detail}` };
    if (native.status !== "complete" || !native.observation)
      return { file, status: "oracle-error", detail: native.detail };
    const engine = await runWorker("engine", file);
    if (engine.status === "unsupported" || engine.status === "incomplete")
      return { file, status: engine.status, detail: engine.detail };
    if (engine.status !== "complete" || !engine.observation)
      return { file, status: "engine-error", detail: engine.detail };
    const bundleHash = native.observation.bundleHash;
    if (!bundleHash || bundleHash !== engine.observation.bundleHash)
      return {
        file,
        status: "harness-error",
        detail: "Application bundles differed between native and engine execution",
      };
    const normalize = (observation: EngineCorpusObservation) =>
      observation.commits.map(({ capturedAt: _capturedAt, ...snapshot }) => snapshot);
    const expected = normalize(native.observation);
    const actual = normalize(engine.observation);
    return isDeepStrictEqual(expected, actual)
      ? { file, bundleHash, status: "matched" }
      : {
          file,
          status: "mismatch",
          bundleHash,
          native: inspect(expected, { depth: null }),
          engine: inspect(actual, { depth: null }),
        };
  };
  const results: CorpusResult[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < selected.length) {
        const file = selected[next++];
        const result = await compare(file);
        results.push(result);
        console.error(JSON.stringify(result));
      }
    }),
  );
  results.sort((left, right) => left.file.localeCompare(right.file));
  const statuses: CorpusResult["status"][] = [
    "matched",
    "mismatch",
    "unsupported",
    "oracle-error",
    "engine-error",
    "harness-error",
    "incomplete",
  ];
  console.log(
    JSON.stringify(
      {
        node: process.version,
        discovered: files.length,
        attempted: selected.length,
        excluded: files.length - selected.length,
        counts: Object.fromEntries(
          statuses.map((status) => [
            status,
            results.filter((result) => result.status === status).length,
          ]),
        ),
        methodology:
          "Production StaticRenderer engine route versus native V8 execution of the same project bundle and React DOM. Fresh process, private browser and bundled React per variant; empty concrete props; no actions. Compare all committed fiber trees except capture timestamps. Shared compilation, snapshot code and virtual offline browser policy are not independent oracles for those layers. No symbolic or trace-equivalence claim. Thirty-second worker deadlines, 512 MiB V8 old-space (not total RSS), 10 MiB output limit; no fallback.",
        results,
      },
      null,
      2,
    ),
  );
  if (results.some((result) => result.status !== "matched")) process.exitCode = 1;
}
