import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { glob } from "tinyglobby";

const metricSchema = z.object({
  total: z.number().int().nonnegative(),
  covered: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  pct: z.union([z.number(), z.literal("Unknown")]),
});
const coverageSchema = z.object({
  statements: metricSchema,
  branches: metricSchema,
  functions: metricSchema,
  lines: metricSchema,
});
const resultsSchema = z.object({
  success: z.boolean(),
  startTime: z.number(),
  testResults: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      assertionResults: z.array(z.object({ fullName: z.string(), status: z.string() })),
    }),
  ),
});

interface ExpectedFiles {
  tests?: string[];
  sources?: string[];
}

const isExplicitDefect = (name: string) =>
  /\bknown (?:divergence|precision gap|crash|limitation|unsupported|defect)\b/i.test(name);

export const summarizeCompatibility = (
  rawResults: unknown,
  rawCoverage: unknown,
  expectedFiles: ExpectedFiles = {},
) => {
  const results = resultsSchema.parse(rawResults);
  const coverage = z.record(z.string(), coverageSchema).parse(rawCoverage);
  if (!coverage.total) throw new Error("Coverage report has no total.");
  const sourceFiles = Object.entries(coverage).filter(([name]) => name !== "total");
  if (!sourceFiles.length) throw new Error("Coverage report contains no source files.");
  const reportedFiles = new Set(results.testResults.map((suite) => suite.name));
  const missingTestFiles = (expectedFiles.tests ?? []).filter((file) => !reportedFiles.has(file));
  const missingSourceFiles = (expectedFiles.sources ?? []).filter((file) => !(file in coverage));
  const assertions = results.testResults.flatMap((suite) =>
    suite.assertionResults.map((assertion) => ({ file: suite.name, ...assertion })),
  );
  if (!assertions.length) throw new Error("Test report contains no assertions.");
  const knownDefects = assertions.filter((assertion) => isExplicitDefect(assertion.fullName));
  const failed = assertions.filter((assertion) => assertion.status === "failed");
  const notRun = assertions.filter((assertion) => !["passed", "failed"].includes(assertion.status));
  const failedSuites = results.testResults
    .filter((suite) => suite.status !== "passed")
    .map((suite) => suite.name);
  const isComplete = (metrics: z.infer<typeof coverageSchema>) =>
    Object.values(metrics).every(
      (metric) => metric.covered === metric.total && metric.skipped === 0 && metric.pct === 100,
    );
  const uncoveredFiles = sourceFiles
    .filter(([, metrics]) => !isComplete(metrics))
    .map(([file, metrics]) => ({ file, metrics }));
  return {
    runStartedAt: new Date(results.startTime).toISOString(),
    testRunSucceeded: results.success,
    testFiles: results.testResults.length,
    assertions: assertions.length,
    ordinaryPassedAssertions: assertions.filter(
      (assertion) => assertion.status === "passed" && !isExplicitDefect(assertion.fullName),
    ).length,
    explicitKnownDefects: knownDefects.length,
    failedAssertions: failed.length,
    notRunAssertions: notRun.length,
    sourceFiles: sourceFiles.length,
    coverage: coverage.total,
    meetsStrictGate:
      results.success &&
      missingTestFiles.length === 0 &&
      missingSourceFiles.length === 0 &&
      failedSuites.length === 0 &&
      failed.length === 0 &&
      notRun.length === 0 &&
      knownDefects.length === 0 &&
      uncoveredFiles.length === 0 &&
      isComplete(coverage.total),
    missingTestFiles,
    missingSourceFiles,
    failedSuites,
    failed,
    notRun,
    knownDefects,
    uncoveredFiles,
  };
};

const main = async () => {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => argument !== "--strict"))
    throw new Error("Usage: pnpm --filter bippy-analyzer compatibility:report [--strict]");
  const coverageDirectory = resolve(import.meta.dirname, "../coverage");
  const readJson = async (name: string): Promise<unknown> =>
    JSON.parse(await readFile(join(coverageDirectory, name), "utf8"));
  const expectedTestFiles = await glob("tests/**/*.test.{ts,tsx}", {
    cwd: resolve(import.meta.dirname, ".."),
    absolute: true,
    ignore: ["**/node_modules/**"],
  });
  const expectedSourceFiles = await glob("src/**/*.{ts,tsx}", {
    cwd: resolve(import.meta.dirname, ".."),
    absolute: true,
    ignore: ["**/node_modules/**"],
  });
  const summary = summarizeCompatibility(
    await readJson("test-results.json"),
    await readJson("coverage-summary.json"),
    { tests: expectedTestFiles, sources: expectedSourceFiles },
  );
  const outputPath = join(coverageDirectory, "compatibility-summary.json");
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        runStartedAt: summary.runStartedAt,
        ordinaryPassedAssertions: summary.ordinaryPassedAssertions,
        explicitKnownDefects: summary.explicitKnownDefects,
        failedAssertions: summary.failedAssertions,
        notRunAssertions: summary.notRunAssertions,
        missingTestFiles: summary.missingTestFiles.length,
        missingSourceFiles: summary.missingSourceFiles.length,
        sourceFiles: summary.sourceFiles,
        uncoveredFiles: summary.uncoveredFiles.length,
        coverage: summary.coverage,
        meetsStrictGate: summary.meetsStrictGate,
        report: relative(process.cwd(), outputPath),
      },
      null,
      2,
    ),
  );
  if (arguments_.includes("--strict") && !summary.meetsStrictGate) process.exitCode = 1;
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === join(import.meta.dirname, "compatibility-report.ts")
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
