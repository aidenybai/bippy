import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { runProbe, type ProbeOptions, type ProbeResult } from "./probe.js";

interface ProbeCase {
  name: string;
  filePath: string;
  props?: ProbeOptions["props"];
}
interface CaseReport {
  name: string;
  prepareMs: number;
  evaluateMs: number;
  mountMs: number;
  totalMs: number;
  stable: boolean;
  result: ProbeResult;
}
interface BackendReport {
  backend: ProbeOptions["backend"];
  node: string;
  firstRunMs: number;
  peakRssMiB: number;
  cases: CaseReport[];
}

const fixtures = resolve(import.meta.dirname, "fixtures");
const cases: ProbeCase[] = [
  {
    name: "async-counter:true",
    filePath: resolve(fixtures, "async-counter.tsx"),
    props: { enabled: true },
  },
  {
    name: "async-counter:false",
    filePath: resolve(fixtures, "async-counter.tsx"),
    props: { enabled: false },
  },
  ...[
    "async-await",
    "loop-cleanup",
    "bigint",
    "hook-identity",
    "descriptors",
    "nested-components",
  ].map((name) => ({ name, filePath: resolve(fixtures, `${name}.tsx`) })),
];
const median = (values: number[]): number =>
  Math.round(values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)] * 100) /
  100;
const getTotal = (result: ProbeResult): number =>
  result.prepareMs + result.evaluateMs + result.mountMs;
const getOutcome = (result: ProbeResult) => ({
  commits: result.commits,
  trace: result.trace,
  errors: result.errors,
  caughtErrors: result.caughtErrors,
  hasPendingWork: result.hasPendingWork,
});

const backend = process.argv[2];
if (backend === "native" || backend === "engine262" || backend === "bippy") {
  const report: BackendReport = {
    backend,
    node: process.version,
    firstRunMs: 0,
    peakRssMiB: 0,
    cases: [],
  };
  for (const probeCase of cases.filter(
    (entry) => !process.argv[3] || entry.name === process.argv[3],
  )) {
    const warmup = await runProbe({ backend, ...probeCase });
    if (report.firstRunMs === 0) report.firstRunMs = getTotal(warmup);
    const samples: ProbeResult[] = [];
    for (let iteration = 0; iteration < 3; iteration++)
      samples.push(await runProbe({ backend, ...probeCase }));
    report.cases.push({
      name: probeCase.name,
      prepareMs: median(samples.map((result) => result.prepareMs)),
      evaluateMs: median(samples.map((result) => result.evaluateMs)),
      mountMs: median(samples.map((result) => result.mountMs)),
      totalMs: median(samples.map(getTotal)),
      stable: samples.every((result) => isDeepStrictEqual(getOutcome(result), getOutcome(warmup))),
      result: samples[0],
    });
  }
  report.peakRssMiB = Math.round((process.resourceUsage().maxRSS / 1024) * 100) / 100;
  await new Promise<void>((resolveWrite) =>
    process.stdout.write(`${JSON.stringify(report)}\n`, () => resolveWrite()),
  );
  // HACK: The Bippy comparison leaves referenced handles after rendering finishes.
  process.exit(0);
} else if (backend === undefined) {
  const reports: BackendReport[] = ["native", "engine262", "bippy"].map((selected) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ["--import", "tsx", fileURLToPath(import.meta.url), selected],
        {
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
          stdio: ["ignore", "pipe", "inherit"],
        },
      ),
    ),
  );
  const native = reports[0];
  console.log(
    JSON.stringify(
      {
        methodology:
          "Separate process per backend. One warmup and three fresh runs per case. Medians include compilation and eight minimum settling rounds. Peak RSS covers the entire worker, not just the interpreter. Bippy trace comparison is unavailable; its commit trees are compared only.",
        comparison: reports.slice(1).map((report) => ({
          backend: report.backend,
          cases: report.cases.map((entry, index) => ({
            name: entry.name,
            commitsMatch: isDeepStrictEqual(
              entry.result.commits,
              native.cases[index].result.commits,
            ),
            traceMatches:
              report.backend === "bippy"
                ? null
                : isDeepStrictEqual(entry.result.trace, native.cases[index].result.trace),
            errors: entry.result.errors,
            stable: entry.stable,
            hasPendingWork: entry.result.hasPendingWork,
          })),
        })),
        reports,
      },
      null,
      2,
    ),
  );
} else throw new Error(`Unknown backend: ${backend}`);
