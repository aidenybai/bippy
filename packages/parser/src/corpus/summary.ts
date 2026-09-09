import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseWithSchema } from "../errors.js";
import type { ComparisonDivergence, ComparisonReport } from "../harness/compare.js";
import type { StateReplaySummary } from "../harness/state-replay.js";
import type {
  DecisionCondition,
  StateCondition,
  StateOmission,
  StateSpaceSummary,
} from "../harness/state-space.js";
import type { StaticRenderStats } from "../types.js";
import type {
  CorpusResult,
  CorpusRuntimeSummary,
  CorpusStaticSummary,
  DiagnosticCount,
} from "./manifest.js";

// Results are persisted per entry so partial corpus runs (one repository at a
// time, static-only passes, browser passes days apart) accumulate into one
// table instead of overwriting each other.

export interface CorpusResultsFile {
  results: CorpusResult[];
}

const divergenceSchema: z.ZodType<ComparisonDivergence> = z.object({
  path: z.string(),
  expected: z.string(),
  actual: z.string(),
});

const reportSchema: z.ZodType<ComparisonReport> = z.object({
  status: z.enum(["exact", "truncated", "partial", "unsound", "mismatch", "unresolved", "skipped"]),
  matchedFibers: z.number(),
  matchedText: z.number(),
  opaqueSubtrees: z.number(),
  opaqueSkippedFibers: z.number(),
  slotsMatched: z.number(),
  slotsUnmatched: z.number(),
  opaqueRenamed: z.number(),
  unmatchedSlots: z.array(
    z.object({
      path: z.string(),
      reason: z.string(),
      head: z.string(),
      skippedFibers: z.number(),
      divergence: divergenceSchema.nullable(),
    }),
  ),
  wildcardAbsorbedFibers: z.number(),
  wildcards: z.array(
    z.object({
      path: z.string(),
      reason: z.string(),
      absorbedFibers: z.number(),
      heads: z.array(z.string()),
    }),
  ),
  branchesResolved: z.number(),
  repeatIterations: z.number(),
  transparentFibers: z.number().default(0),
  runtimeFibers: z.number(),
  staticFibers: z.number(),
  coverage: z.number(),
  strictCoverage: z.number(),
  divergence: divergenceSchema.nullable(),
  stepsUsed: z.number(),
  budgetExhausted: z.boolean(),
});

const branchConditionSchema = z.object({
  kind: z.enum(["branch", "state-update"]),
  variable: z.string(),
  reason: z.string(),
  location: z.string().nullable(),
  alternativeIndex: z.number(),
  alternativeCount: z.number(),
});

const repeatConditionSchema = z.object({
  kind: z.literal("repeat"),
  variable: z.string(),
  location: z.string().nullable(),
  count: z.number(),
});

const decisionConditionSchema: z.ZodType<DecisionCondition> = z.discriminatedUnion("kind", [
  branchConditionSchema,
  repeatConditionSchema,
]);

const stateConditionSchema: z.ZodType<StateCondition> = z.discriminatedUnion("kind", [
  branchConditionSchema,
  repeatConditionSchema,
  z.object({ kind: z.literal("transition"), commit: z.number(), commitCount: z.number() }),
]);

const stateOmissionSchema: z.ZodType<StateOmission> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("branch"),
    variable: z.string(),
    reason: z.string(),
    location: z.string().nullable(),
    alternativeIndex: z.number(),
    conditions: z.array(stateConditionSchema),
  }),
  z.object({
    kind: z.literal("repeat"),
    variable: z.string(),
    location: z.string().nullable(),
    countsAbove: z.number(),
    max: z.number().nullable(),
    conditions: z.array(stateConditionSchema),
  }),
  z.object({ kind: z.literal("state"), conditions: z.array(stateConditionSchema) }),
  z.object({ kind: z.literal("subtree"), reason: z.string() }),
]);

const stateSpaceSummarySchema: z.ZodType<StateSpaceSummary> = z.object({
  states: z.number(),
  matchedState: z
    .object({ index: z.number().nullable(), conditions: z.array(stateConditionSchema) })
    .nullable(),
  closestState: z.object({ index: z.number(), divergence: divergenceSchema }).nullable(),
  omitted: z.object({ total: z.number(), omissions: z.array(stateOmissionSchema) }).nullable(),
});

const stateReplaySummarySchema: z.ZodType<StateReplaySummary> = z.object({
  states: z.number(),
  assignments: z.number(),
  replayed: z.number(),
  maxReplayed: z.number(),
  mismatched: z.array(
    z.object({
      stateIndices: z.array(z.number()),
      conditions: z.array(decisionConditionSchema),
      claimedCommits: z.number(),
      replayedCommits: z.number(),
      divergence: divergenceSchema,
      isCorrected: z.boolean(),
    }),
  ),
});

const runtimeSummarySchema: z.ZodType<CorpusRuntimeSummary> = z.object({
  reactVersion: z.string().nullable(),
  rendererName: z.string().nullable(),
  buildType: z.enum(["development", "production"]).nullable(),
  roots: z.number(),
  fibers: z.number(),
  commits: z.number(),
  pageErrors: z.array(z.string()),
  title: z.string(),
});

const statsSchema: z.ZodType<StaticRenderStats> = z.object({
  fiberCount: z.number(),
  textCount: z.number(),
  branchCount: z.number(),
  repeatCount: z.number(),
  opaqueCount: z.number(),
  unknownCount: z.number(),
  modulesLoaded: z.number(),
});

const diagnosticCountSchema: z.ZodType<DiagnosticCount> = z.object({
  code: z.string(),
  count: z.number(),
});

const staticSummarySchema: z.ZodType<CorpusStaticSummary> = z.object({
  stats: statsSchema,
  diagnostics: z.array(diagnosticCountSchema),
});

const resultSchema: z.ZodType<CorpusResult> = z.object({
  id: z.string(),
  revision: z.string(),
  framework: z.enum(["spa", "next-app", "next-pages", "react-router"]),
  capturedAt: z.string(),
  durationMs: z.number(),
  runtime: runtimeSummarySchema.nullable(),
  static: staticSummarySchema.nullable(),
  report: reportSchema.nullable(),
  stateSpace: stateSpaceSummarySchema.nullable(),
  stateReplay: stateReplaySummarySchema.nullable().default(null),
  anchor: z.string().nullable(),
  note: z.string().nullable(),
  failure: z.string().nullable(),
});

const resultsFileSchema: z.ZodType<CorpusResultsFile> = z.object({
  results: z.array(resultSchema),
});

export const readCorpusResults = (resultsPath: string): CorpusResultsFile =>
  parseWithSchema(resultsFileSchema, JSON.parse(readFileSync(resultsPath, "utf8")), resultsPath);

export const mergeCorpusResults = (
  previous: CorpusResult[],
  fresh: CorpusResult[],
): CorpusResult[] => {
  const byId = new Map(previous.map((result) => [result.id, result]));
  for (const result of fresh) byId.set(result.id, result);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
};

const percent = (value: number): string => `${Math.round(value * 100)}%`;

const outcome = (result: CorpusResult): string => {
  if (result.failure) return `failed: ${result.failure}`;
  if (result.report) return result.report.status;
  if (result.static) return result.note ?? "static only";
  return "no result";
};

const describeStateSpace = (stateSpace: StateSpaceSummary): string => {
  const parts = [`${stateSpace.states} states${stateSpace.omitted ? " (incomplete)" : ""}`];
  if (stateSpace.matchedState) {
    parts.push(
      stateSpace.matchedState.index === null
        ? "matched outside the enumerated set"
        : `matched #${stateSpace.matchedState.index + 1}`,
    );
  } else if (stateSpace.closestState) {
    parts.push(`closest #${stateSpace.closestState.index + 1}`);
  }
  if (stateSpace.omitted) parts.push(`${stateSpace.omitted.total} omitted`);
  return parts.join(", ");
};

const describeStateReplay = (replay: StateReplaySummary): string => {
  const sampled = replay.replayed < replay.assignments ? " (sampled)" : "";
  return `replayed ${replay.replayed}/${replay.assignments} assignments${sampled}, ${replay.mismatched.length} mismatched`;
};

const describeStatic = (result: CorpusResult): string => {
  if (!result.static) return "-";
  const { stats } = result.static;
  const parts = [`${stats.fiberCount} fibers`];
  if (stats.branchCount) parts.push(`${stats.branchCount} branches`);
  if (stats.repeatCount) parts.push(`${stats.repeatCount} repeats`);
  if (stats.opaqueCount) parts.push(`${stats.opaqueCount} opaque`);
  if (stats.unknownCount) parts.push(`${stats.unknownCount} unknown`);
  return parts.join(", ");
};

const describeRuntime = (result: CorpusResult): string => {
  if (!result.runtime) return "-";
  const { runtime } = result;
  const version = runtime.reactVersion ?? "react ?";
  return `${runtime.fibers} fibers (react ${version}, ${runtime.commits} commits)`;
};

const describeComparison = (result: CorpusResult): string => {
  if (!result.report) return "-";
  const { report } = result;
  const parts = [
    `coverage ${percent(report.coverage)} (strict ${percent(report.strictCoverage)})`,
    `${report.matchedFibers} matched`,
  ];
  if (result.stateSpace) parts.push(describeStateSpace(result.stateSpace));
  if (result.stateReplay) parts.push(describeStateReplay(result.stateReplay));
  if (report.opaqueSubtrees) {
    parts.push(
      `${report.opaqueSubtrees} opaque (${report.opaqueSkippedFibers} skipped, slots ${report.slotsMatched}/${report.slotsMatched + report.slotsUnmatched})`,
    );
  }
  if (report.divergence) {
    parts.push(
      `diverged at ${report.divergence.path}: expected ${report.divergence.expected}, saw ${report.divergence.actual}`,
    );
  }
  return parts.join("; ");
};

export const formatCorpusTable = (results: CorpusResult[]): string => {
  const rows = results.map((result) => [
    result.id,
    result.framework,
    outcome(result),
    describeStatic(result),
    describeRuntime(result),
    describeComparison(result),
  ]);
  const header = ["entry", "framework", "outcome", "static", "runtime", "comparison"];
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column])).join("  ");
  return [line(header), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join(
    "\n",
  );
};

export const formatCorpusMarkdown = (results: CorpusResult[]): string => {
  const header = "| entry | framework | outcome | static | runtime | comparison |";
  const divider = "| --- | --- | --- | --- | --- | --- |";
  const escape = (cell: string): string => cell.replace(/\|/g, "\\|");
  const rows = results.map(
    (result) =>
      `| ${[
        result.id,
        result.framework,
        outcome(result),
        describeStatic(result),
        describeRuntime(result),
        describeComparison(result),
      ]
        .map(escape)
        .join(" | ")} |`,
  );
  return [header, divider, ...rows].join("\n");
};
