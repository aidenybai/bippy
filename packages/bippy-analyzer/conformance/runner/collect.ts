import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject, toJson } from "../../src/symbolic-tree/analyze.ts";
import type { AnalyzedComponent } from "../../src/symbolic-tree/print.ts";

export interface CollectSummary {
  files: number;
  components: number;
  states: number;
  transitions: number;
  deadBranches: number;
  truncatedComponents: number;
  slots: number;
  untypedSlots: number;
  unresolvedTypeSlots: number;
  bailouts: Record<string, number>;
  durationMs: number;
}

const summarize = (
  components: AnalyzedComponent[],
  fileCount: number,
  durationMs: number,
): CollectSummary => {
  const bailouts: Record<string, number> = {};
  for (const { model } of components) {
    for (const bailout of model.bailouts)
      bailouts[bailout.reason] = (bailouts[bailout.reason] ?? 0) + 1;
  }
  return {
    files: fileCount,
    components: components.length,
    states: components.reduce((total, { report }) => total + report.states.length, 0),
    transitions: components.reduce((total, { model }) => total + model.transitions.length, 0),
    deadBranches: components.reduce((total, { report }) => total + report.deadBranches.length, 0),
    truncatedComponents: components.filter(({ report }) => report.isTruncated).length,
    slots: components.reduce((total, { model }) => total + model.slots.length, 0),
    untypedSlots: components.reduce(
      (total, { model }) =>
        total + model.slots.filter((slot) => slot.domain.kind === "unknown").length,
      0,
    ),
    unresolvedTypeSlots: components.reduce(
      (total, { model }) =>
        total +
        model.slots.filter(
          (slot) => slot.domain.kind === "unknown" && slot.domain.reason === "unresolved-type",
        ).length,
      0,
    ),
    bailouts,
    durationMs,
  };
};

export const collect = (tsconfigPath: string, outputDirectory: string): CollectSummary => {
  const startTime = performance.now();
  const { components, fileCount } = analyzeProject(resolve(tsconfigPath), undefined);
  const summary = summarize(components, fileCount, Math.round(performance.now() - startTime));
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, "model.json"), toJson(components));
  writeFileSync(join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [tsconfigPath, outputDirectory] = process.argv.slice(2);
  if (!tsconfigPath || !outputDirectory)
    throw new Error("Usage: collect.ts <tsconfig> <outputDirectory>");
  console.log(JSON.stringify(collect(tsconfigPath, outputDirectory)));
}
