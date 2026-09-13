import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";
import { formatMb, formatMs, loadCorpusTargets } from "./corpus-target.js";
import {
  PROGRAM_VARIANTS,
  type ProgramVariant,
  type SourceFileCounts,
  buildProgram,
  getHeapUsedMb,
  getPeakRssMb,
  isNodeModulesFile,
  loadTsconfig,
  timeSync,
} from "./program.js";

export interface ProgramMeasurement {
  entryId: string;
  variant: ProgramVariant;
  ok: boolean;
  failure: string | null;
  tsconfigFileNames: number;
  configErrors: string[];
  createProgramMs: number;
  createCheckerMs: number;
  entryFileCheckMs: number;
  entryFileDiagnostics: number;
  identifierQueryCount: number;
  identifierQueryMs: number;
  fullCheckMs: number | null;
  fullCheckDiagnostics: number | null;
  counts: SourceFileCounts;
  heapUsedMb: number;
  peakRssMb: number;
  wallClockMs: number;
}

const HEAP_LIMIT_MB = 24_000;
const CHILD_TIMEOUT_MS = 20 * 60_000;
const RESULT_PREFIX = "@@result ";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "corpus-dir": { type: "string" },
    variant: { type: "string" },
    "full-check": { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const corpusDirectory = path.resolve(values["corpus-dir"] ?? ".corpus");

const countIdentifierTypes = (
  program: ts.Program,
  checker: ts.TypeChecker,
  entryFile: string,
): { count: number; elapsedMs: number } => {
  const sourceFile = program.getSourceFile(entryFile);
  if (!sourceFile) return { count: 0, elapsedMs: 0 };
  let count = 0;
  const timed = timeSync(() => {
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        checker.getTypeAtLocation(node);
        count += 1;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  });
  return { count, elapsedMs: timed.elapsedMs };
};

const runChild = (entryId: string, variant: ProgramVariant): void => {
  const startedAt = performance.now();
  const [target] = loadCorpusTargets(corpusDirectory, [entryId]);
  const measurement: ProgramMeasurement = {
    entryId,
    variant,
    ok: false,
    failure: null,
    tsconfigFileNames: 0,
    configErrors: [],
    createProgramMs: 0,
    createCheckerMs: 0,
    entryFileCheckMs: 0,
    entryFileDiagnostics: 0,
    identifierQueryCount: 0,
    identifierQueryMs: 0,
    fullCheckMs: null,
    fullCheckDiagnostics: null,
    counts: { total: 0, project: 0, nodeModules: 0, declarations: 0, lib: 0 },
    heapUsedMb: 0,
    peakRssMb: 0,
    wallClockMs: 0,
  };
  try {
    const config = loadTsconfig(target.tsconfigPath);
    measurement.tsconfigFileNames = config.fileNames.length;
    measurement.configErrors = config.configErrors;
    const build = buildProgram(variant, config, target.entryFile);
    measurement.createProgramMs = build.createProgramMs;
    measurement.createCheckerMs = build.createCheckerMs;
    measurement.counts = build.counts;
    const entrySourceFile = build.program.getSourceFile(target.entryFile);
    const entryCheck = timeSync(() =>
      entrySourceFile ? build.program.getSemanticDiagnostics(entrySourceFile) : [],
    );
    measurement.entryFileCheckMs = entryCheck.elapsedMs;
    measurement.entryFileDiagnostics = entryCheck.result.length;
    const identifierQueries = countIdentifierTypes(build.program, build.checker, target.entryFile);
    measurement.identifierQueryCount = identifierQueries.count;
    measurement.identifierQueryMs = identifierQueries.elapsedMs;
    if (values["full-check"]) {
      const fullCheck = timeSync(() =>
        build.program
          .getSourceFiles()
          .filter(
            (sourceFile) =>
              !sourceFile.isDeclarationFile && !isNodeModulesFile(sourceFile.fileName),
          )
          .reduce(
            (sum, sourceFile) => sum + build.program.getSemanticDiagnostics(sourceFile).length,
            0,
          ),
      );
      measurement.fullCheckMs = fullCheck.elapsedMs;
      measurement.fullCheckDiagnostics = fullCheck.result;
    }
    measurement.ok = true;
  } catch (error) {
    measurement.failure =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  measurement.heapUsedMb = getHeapUsedMb();
  measurement.peakRssMb = getPeakRssMb();
  measurement.wallClockMs = performance.now() - startedAt;
  console.log(`${RESULT_PREFIX}${JSON.stringify(measurement)}`);
};

const isProgramMeasurement = (value: unknown): value is ProgramMeasurement =>
  typeof value === "object" && value !== null && "variant" in value && "counts" in value;

const parseChildResult = (stdout: string): ProgramMeasurement | null => {
  const line = stdout.split("\n").find((candidate) => candidate.startsWith(RESULT_PREFIX));
  if (!line) return null;
  const parsed: unknown = JSON.parse(line.slice(RESULT_PREFIX.length));
  return isProgramMeasurement(parsed) ? parsed : null;
};

const spawnMeasurement = (entryId: string, variant: ProgramVariant): ProgramMeasurement => {
  const scriptPath = fileURLToPath(import.meta.url);
  const startedAt = performance.now();
  const child = spawnSync(
    "pnpm",
    [
      "exec",
      "tsx",
      scriptPath,
      "--corpus-dir",
      corpusDirectory,
      "--variant",
      variant,
      ...(values["full-check"] ? ["--full-check"] : []),
      entryId,
    ],
    {
      cwd: path.dirname(scriptPath),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: CHILD_TIMEOUT_MS,
      env: { ...process.env, NODE_OPTIONS: `--max-old-space-size=${HEAP_LIMIT_MB}` },
    },
  );
  const parsed = parseChildResult(child.stdout ?? "");
  if (parsed) return parsed;
  const failure = child.error
    ? `${child.error.name}: ${child.error.message}`
    : `exit ${child.status ?? "?"} signal ${child.signal ?? "-"}: ${(child.stderr ?? "").trim().split("\n").slice(-5).join(" | ")}`;
  return {
    entryId,
    variant,
    ok: false,
    failure,
    tsconfigFileNames: 0,
    configErrors: [],
    createProgramMs: 0,
    createCheckerMs: 0,
    entryFileCheckMs: 0,
    entryFileDiagnostics: 0,
    identifierQueryCount: 0,
    identifierQueryMs: 0,
    fullCheckMs: null,
    fullCheckDiagnostics: null,
    counts: { total: 0, project: 0, nodeModules: 0, declarations: 0, lib: 0 },
    heapUsedMb: 0,
    peakRssMb: 0,
    wallClockMs: performance.now() - startedAt,
  };
};

const formatRow = (measurement: ProgramMeasurement): string => {
  const cells = [
    measurement.entryId,
    measurement.variant,
    measurement.ok ? "ok" : `FAILED: ${measurement.failure}`,
    formatMs(measurement.createProgramMs),
    formatMs(measurement.createCheckerMs),
    formatMs(measurement.entryFileCheckMs),
    `${measurement.identifierQueryCount} ids / ${formatMs(measurement.identifierQueryMs)}`,
    measurement.fullCheckMs === null ? "-" : formatMs(measurement.fullCheckMs),
    `${measurement.counts.total} (${measurement.counts.project} project, ${measurement.counts.nodeModules} node_modules, ${measurement.counts.lib} lib)`,
    formatMb(measurement.peakRssMb),
    formatMs(measurement.wallClockMs),
  ];
  return `| ${cells.join(" | ")} |`;
};

const main = (): void => {
  const variantArg = values.variant;
  if (variantArg !== undefined) {
    const variant = PROGRAM_VARIANTS.find((candidate) => candidate === variantArg);
    if (!variant) throw new Error(`unknown variant "${variantArg}"`);
    runChild(positionals[0], variant);
    return;
  }
  const ids =
    positionals.length > 0
      ? positionals
      : ["sonner", "react-router-templates", "sentry", "posthog"];
  const measurements: ProgramMeasurement[] = [];
  console.log(
    "| entry | variant | status | createProgram | checker | check entry file | getTypeAtLocation on entry identifiers | full semantic check | source files | peak RSS | wall clock |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const id of ids) {
    for (const variant of PROGRAM_VARIANTS) {
      const measurement = spawnMeasurement(id, variant);
      measurements.push(measurement);
      console.log(formatRow(measurement));
    }
  }
  if (values.out) {
    mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
    writeFileSync(path.resolve(values.out), JSON.stringify(measurements, null, 2));
  }
};

main();
