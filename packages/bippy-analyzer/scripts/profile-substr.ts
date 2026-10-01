import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus } from "node:os";
import { join, resolve } from "node:path";

interface ProfileMode {
  name: string;
  flags: string[];
}

interface ProfileResult {
  mode: ProfileMode;
  profile: string;
  milliseconds: number;
  status: number | null;
  signal: NodeJS.Signals | null;
  error: Error | undefined;
  stdout: string;
  stderr: string;
}

const directory = resolve("engine/.build/profiles");
mkdirSync(directory, { recursive: true });
const sourceFiles = [
  ".test262/harness/assert.js",
  ".test262/harness/sta.js",
  ".test262/test/annexB/built-ins/String/prototype/substr/start-and-length-as-numbers.js",
];
const source = sourceFiles.map((filename) => readFileSync(filename, "utf8")).join("\n");
const input = join(directory, "input.js");
writeFileSync(input, source);
const getHash = (contents: string | Buffer) => createHash("sha256").update(contents).digest("hex");
const modes: ProfileMode[] = [
  { name: "default", flags: [] },
  { name: "no-maglev", flags: ["--no-maglev"] },
];
const results: ProfileResult[] = [];
const receipt = {
  scope: "diagnostic-only-not-a-test262-verdict",
  node: process.version,
  versions: process.versions,
  platform: process.platform,
  architecture: process.arch,
  cpuModel: cpus()[0]?.model,
  availableParallelism: availableParallelism(),
  workers: 1,
  diagnosticTimeoutMilliseconds: 30_000,
  sourceFiles,
  sourceSha256: getHash(source),
  engineSha256: getHash(readFileSync("engine/dist/engine.mjs")),
  results,
};
for (const mode of modes) {
  const profile = `${mode.name}.cpuprofile`;
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [
      ...mode.flags,
      "--cpu-prof",
      `--cpu-prof-dir=${directory}`,
      `--cpu-prof-name=${profile}`,
      "--import",
      "tsx",
      "engine/scripts/cli.ts",
      "--no-inspect",
      input,
    ],
    {
      encoding: "utf8",
      timeout: receipt.diagnosticTimeoutMilliseconds,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  results.push({
    mode,
    profile,
    milliseconds: performance.now() - started,
    status: result.status,
    signal: result.signal,
    error: result.error
      ? {
          ...result.error,
          name: result.error.name,
          message: result.error.message,
          stack: result.error.stack,
        }
      : undefined,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  writeFileSync(join(directory, "summary.json"), `${JSON.stringify(receipt, null, 2)}\n`);
}
console.log(JSON.stringify(receipt, null, 2));
