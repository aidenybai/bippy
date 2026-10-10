import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeProject,
  serializeProjectAnalysis,
} from "../../src/core/entrypoint/analyze-project.js";
import type { AnalyzedComponent } from "../../src/core/inference/types.js";
import type { ComponentVerdict } from "../../tests/verify/score.js";
import { verifyProject } from "../../tests/verify/verify.js";

export interface VerificationSummary {
  verified: number;
  couldNotMount: number;
  notExported: number;
  wrong: number;
  predictedStates: number;
  witnessedStates: number;
  branchSides: number;
  witnessedBranchSides: number;
  mountErrors: Record<string, number>;
  durationMs: number;
}

export interface CollectSummary {
  files: number;
  components: number;
  states: number;
  transitions: number;
  deadBranches: number;
  truncatedComponents: number;
  bindings: number;
  untypedBindings: number;
  unresolvedTypeBindings: number;
  bailouts: Record<string, number>;
  durationMs: number;
  verification: VerificationSummary | null;
}

export interface CollectOptions {
  shouldVerify: boolean;
}

const MOUNT_ERROR_LENGTH = 80;

const sum = <Item>(items: Item[], getValue: (item: Item) => number): number =>
  items.reduce((total, item) => total + getValue(item), 0);

const countWrong = (verdict: ComponentVerdict): number =>
  verdict.wrongStates.length +
  verdict.wrongEdges.length +
  verdict.wrongValues.length +
  verdict.refutedDeadClaims.length;

const summarizeVerification = (
  verdicts: ComponentVerdict[],
  durationMs: number,
): VerificationSummary => {
  const verified = verdicts.filter((verdict) => verdict.status === "verified");
  const mountErrors: Record<string, number> = {};
  for (const verdict of verdicts) {
    if (verdict.status !== "mount-failed") continue;
    const message = (verdict.error ?? "unknown").replace(/\d+/g, "N").slice(0, MOUNT_ERROR_LENGTH);
    mountErrors[message] = (mountErrors[message] ?? 0) + 1;
  }
  return {
    verified: verified.length,
    couldNotMount: verdicts.filter((verdict) => verdict.status === "mount-failed").length,
    notExported: verdicts.filter((verdict) => verdict.status === "not-exported").length,
    wrong: sum(verified, countWrong),
    predictedStates: sum(verified, (verdict) => verdict.predictedStates),
    witnessedStates: sum(verified, (verdict) => verdict.witnessedStates.length),
    branchSides: sum(verified, (verdict) => verdict.branchSides),
    witnessedBranchSides: sum(verified, (verdict) => verdict.witnessedBranchSides),
    mountErrors,
    durationMs,
  };
};

const summarize = (
  components: AnalyzedComponent[],
  fileCount: number,
  durationMs: number,
  verification: VerificationSummary | null,
): CollectSummary => {
  const bailouts: Record<string, number> = {};
  for (const { analysis } of components) {
    for (const bailout of analysis.bailouts)
      bailouts[bailout.reason] = (bailouts[bailout.reason] ?? 0) + 1;
  }
  const bindings = components.flatMap(({ analysis }) => analysis.bindings);
  return {
    files: fileCount,
    components: components.length,
    states: sum(components, ({ report }) => report.states.length),
    transitions: sum(components, ({ analysis }) => analysis.transitions.length),
    deadBranches: sum(components, ({ report }) => report.deadBranches.length),
    truncatedComponents: components.filter(({ report }) => report.isTruncated).length,
    bindings: bindings.length,
    untypedBindings: bindings.filter((binding) => binding.domain.kind === "Unknown").length,
    unresolvedTypeBindings: bindings.filter(
      (binding) => binding.domain.kind === "Unknown" && binding.domain.reason === "unresolved",
    ).length,
    bailouts,
    durationMs,
    verification,
  };
};

export const collect = async (
  tsconfigPath: string,
  outputDirectory: string,
  options: CollectOptions,
): Promise<CollectSummary> => {
  const startTime = performance.now();
  const configPath = resolve(tsconfigPath);
  const projectAnalysis = analyzeProject(configPath);
  const { components, fileCount } = projectAnalysis;
  const analysisDuration = Math.round(performance.now() - startTime);
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, "analysis.json"), serializeProjectAnalysis(projectAnalysis));
  let verification: VerificationSummary | null = null;
  if (options.shouldVerify) {
    const report = await verifyProject(configPath, { analyzed: components });
    writeFileSync(join(outputDirectory, "verify.json"), `${JSON.stringify(report, null, 2)}\n`);
    verification = summarizeVerification(report.components, report.durationMs);
  }
  const summary = summarize(components, fileCount, analysisDuration, verification);
  writeFileSync(join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [tsconfigPath, outputDirectory] = process.argv.slice(2);
  if (!tsconfigPath || !outputDirectory)
    throw new Error("Usage: collect.ts <tsconfig> <outputDirectory> [--verify]");
  console.log(
    JSON.stringify(
      await collect(tsconfigPath, outputDirectory, {
        shouldVerify: process.argv.includes("--verify"),
      }),
    ),
  );
}
