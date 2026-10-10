import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeProject,
  serializeProjectAnalysis,
} from "../../src/core/entrypoint/analyze-project.js";
import type { AnalyzedComponent } from "../../src/core/inference/types.js";
import { sum, summarizeVerdicts } from "../../tests/verify/score.js";
import type { VerificationSummary } from "../../tests/verify/score.js";
import { verifyProject } from "../../tests/verify/verify.js";

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
  shouldVerify: boolean,
): Promise<CollectSummary> => {
  const startTime = performance.now();
  const configPath = resolve(tsconfigPath);
  const projectAnalysis = analyzeProject(configPath);
  const { components, fileCount } = projectAnalysis;
  const analysisDuration = Math.round(performance.now() - startTime);
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, "analysis.json"), serializeProjectAnalysis(projectAnalysis));
  let verification: VerificationSummary | null = null;
  if (shouldVerify) {
    const report = await verifyProject(configPath, { analyzed: components });
    writeFileSync(join(outputDirectory, "verify.json"), `${JSON.stringify(report, null, 2)}\n`);
    verification = summarizeVerdicts(report.components, report.durationMs);
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
    JSON.stringify(await collect(tsconfigPath, outputDirectory, process.argv.includes("--verify"))),
  );
}
