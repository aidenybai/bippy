import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../../../src/core/analyze-project";
import { serializeProjectAnalysis } from "../../../src/core/serialize";
import type { AnalyzedComponent, BailoutReason } from "../../../src/core/types";
import { sum, summarizeVerdicts } from "../verifier/score";
import type { VerificationSummary } from "../verifier/score";
import { verifyProject } from "../verifier/verify";

export interface CollectSummary {
  fileCount: number;
  componentCount: number;
  stateCount: number;
  handlerCount: number;
  unreachableBranchCount: number;
  truncatedComponentCount: number;
  bindingCount: number;
  untypedBindingCount: number;
  unresolvedTypeBindingCount: number;
  bailoutCountsByReason: Partial<Record<BailoutReason, number>>;
  durationMs: number;
  verification: VerificationSummary | null;
}

const summarize = (
  components: AnalyzedComponent[],
  fileCount: number,
  durationMs: number,
  verification: VerificationSummary | null,
): CollectSummary => {
  const bailoutCountsByReason: Partial<Record<BailoutReason, number>> = {};
  for (const { analysis } of components)
    for (const { reason } of analysis.bailouts)
      bailoutCountsByReason[reason] = (bailoutCountsByReason[reason] ?? 0) + 1;
  const bindings = components.flatMap(({ analysis }) => analysis.bindings);
  return {
    fileCount,
    componentCount: components.length,
    stateCount: sum(components, ({ report }) => report.states.length),
    handlerCount: sum(components, ({ analysis }) => analysis.handlers.length),
    unreachableBranchCount: sum(components, ({ report }) => report.unreachableBranches.length),
    truncatedComponentCount: components.filter(({ report }) => report.isTruncated).length,
    bindingCount: bindings.length,
    untypedBindingCount: bindings.filter((binding) => binding.domain.kind === "Unknown").length,
    unresolvedTypeBindingCount: bindings.filter(
      (binding) => binding.domain.kind === "Unknown" && binding.domain.reason === "unresolved",
    ).length,
    bailoutCountsByReason,
    durationMs,
    verification,
  };
};

export const collect = async (
  tsconfigPath: string,
  outputDirectory: string,
  shouldVerify: boolean,
  setupDirectory: string | null,
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
    const report = await verifyProject(configPath, { analyzed: components, setupDirectory });
    writeFileSync(join(outputDirectory, "verify.json"), `${JSON.stringify(report, null, 2)}\n`);
    verification = summarizeVerdicts(report.verdicts, report.durationMs);
  }
  const summary = summarize(components, fileCount, analysisDuration, verification);
  writeFileSync(join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [tsconfigPath, outputDirectory] = process.argv.slice(2);
  if (!tsconfigPath || !outputDirectory)
    throw new Error("Usage: collect.ts <tsconfig> <outputDirectory> [--verify] [--setup <dir>]");
  const setupIndex = process.argv.indexOf("--setup");
  console.log(
    JSON.stringify(
      await collect(
        tsconfigPath,
        outputDirectory,
        process.argv.includes("--verify"),
        setupIndex === -1 ? null : (process.argv[setupIndex + 1] ?? null),
      ),
    ),
  );
}
