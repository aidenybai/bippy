import Table from "cli-table3";
import pc from "picocolors";
import {
  COVERAGE_GOOD_PCT,
  COVERAGE_WARN_PCT,
  FILE_COLUMN_MAX_WIDTH,
  UNCOVERED_COLUMN_WIDTH,
} from "./constants.js";
import type {
  BranchGap,
  CoverageSummary,
  DepthSummary,
  EdgeCase,
  HotDecisionTarget,
  InteractionSummary,
  Mutation,
  WorklistDelta,
  WorklistItem,
} from "./report.js";

export interface FormatTableOptions {
  /** Show only the n least-covered files instead of the full path-sorted table. */
  top?: number;
  /** Label appended to the totals row, e.g. the served-URL filter that was used. */
  filterLabel?: string;
  /** Render the targeted mutation manifest section (on by default; pass false to hide). */
  mutations?: boolean;
}

/** Elide from the front so the basename (the useful tail) survives. */
const elideHead = (text: string, width: number): string =>
  text.length > width ? `…${text.slice(text.length - width + 1)}` : text;

const elideTail = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text;

const colorPct = (pct: number): string => {
  const label = `${pct}`;
  if (pct >= COVERAGE_GOOD_PCT) return pc.green(label);
  if (pct >= COVERAGE_WARN_PCT) return pc.yellow(label);
  return pc.red(label);
};

const basename = (filePath: string): string => filePath.slice(filePath.lastIndexOf("/") + 1);

const formatGap = (gap?: { line: number; depth: number; file?: string }): string => {
  if (!gap) return "—";
  const where = gap.file ? `${gap.file}:${gap.line}` : `L${gap.line}`;
  return `${where} (depth ${gap.depth})`;
};

// "src/core/index.tsx:1245" when source-mapped, else the served "L1245".
const formatLocation = (target: { file?: string; line: number }, script: string): string =>
  target.file ? `${target.file}:${target.line}` : `${basename(script)}:L${target.line}`;

interface FileSignal {
  maxDepth: number;
  branch: number;
  edge: number;
  mutation: number;
}

// Roll the unified worklist up per file: the deepest item and a count of each
// kind, so the per-file table can show what the file needs, not just its %s.
// Keyed by both the full path and its basename, because the report's file paths
// (from the remap engine) and the worklist's (from our source-map resolve) can
// be formatted differently; the basename is the robust join fallback.
const fileSignals = (summary: CoverageSummary): Map<string, FileSignal> => {
  const byKey = new Map<string, FileSignal>();
  for (const item of summary.worklist ?? []) {
    if (!item.file) continue;
    for (const key of [item.file, item.file.slice(item.file.lastIndexOf("/") + 1)]) {
      const signal = byKey.get(key) ?? { maxDepth: 0, branch: 0, edge: 0, mutation: 0 };
      signal.maxDepth = Math.max(signal.maxDepth, item.depth);
      if (item.kind === "branch") signal.branch++;
      else if (item.kind === "edge") signal.edge++;
      else if (item.kind === "mutation") signal.mutation++;
      byKey.set(key, signal);
    }
  }
  return byKey;
};

// Compact cell: deepest guard reached plus branch/edge/mutant counts, e.g.
// "d12 3b 2e 1m". Blank when the file carries no surfaced worklist items.
const signalCell = (signal: FileSignal | undefined): string => {
  if (!signal) return pc.dim("—");
  const parts: string[] = [];
  if (signal.maxDepth > 0) parts.push(`d${signal.maxDepth}`);
  if (signal.branch > 0) parts.push(`${signal.branch}b`);
  if (signal.edge > 0) parts.push(`${signal.edge}e`);
  if (signal.mutation > 0) parts.push(`${signal.mutation}m`);
  return parts.length > 0 ? parts.join(" ") : pc.dim("—");
};

/**
 * Render an istanbul-style per-file table — Lines% / Branch% / Func% with a
 * high-fidelity Signals column (deepest guard, branch-gap / edge / mutant counts)
 * and uncovered line ranges. The default lists every file sorted by path; `top`
 * restricts it to the n files with the most uncovered lines for quick triage.
 * Percentages are colored by threshold; picocolors no-ops when piped or
 * `NO_COLOR` is set.
 */
export const formatCoverageTable = (
  summary: CoverageSummary,
  options: FormatTableOptions = {},
): string => {
  const limitToLeastCovered = typeof options.top === "number";
  // Rank by the *number* of uncovered lines, not the percentage: a 2-line file
  // at 0% is less worth a test than a 200-line file at 60%, and percentage alone
  // floats trivial files to the top. Ties break on lower percentage, then path.
  const uncoveredLines = (file: (typeof summary.files)[number]): number =>
    file.lines.total - file.lines.covered;
  const rows = [...summary.files].sort(
    limitToLeastCovered
      ? (a, b) =>
          uncoveredLines(b) - uncoveredLines(a) ||
          a.lines.pct - b.lines.pct ||
          a.file.localeCompare(b.file)
      : (a, b) => a.file.localeCompare(b.file),
  );
  const shown = limitToLeastCovered ? rows.slice(0, options.top) : rows;

  // Per-file rollup of the high-fidelity worklist: the deepest guard reached and
  // how many branch gaps / edge cases / mutants the file carries. This is what
  // makes the istanbul-shaped table carry our depth intelligence, not just %s.
  const signals = fileSignals(summary);

  const table = new Table({
    head: [
      pc.bold("File"),
      pc.bold("Lines%"),
      pc.bold("Branch%"),
      pc.bold("Func%"),
      pc.bold("Signals"),
      pc.bold("Uncovered lines"),
    ],
    colAligns: ["left", "right", "right", "right", "left", "left"],
    style: { head: [], border: [] },
  });

  for (const row of shown) {
    table.push([
      elideHead(row.file, FILE_COLUMN_MAX_WIDTH),
      colorPct(row.lines.pct),
      colorPct(row.branches.pct),
      colorPct(row.functions.pct),
      signalCell(
        signals.get(row.file) ?? signals.get(row.file.slice(row.file.lastIndexOf("/") + 1)),
      ),
      pc.dim(elideTail(row.uncoveredLines, UNCOVERED_COLUMN_WIDTH)),
    ]);
  }

  const totalsLabel = `All files${options.filterLabel ? ` [${options.filterLabel}]` : ""}`;
  table.push([
    pc.bold(elideHead(totalsLabel, FILE_COLUMN_MAX_WIDTH)),
    pc.bold(colorPct(summary.lines.pct)),
    pc.bold(colorPct(summary.branches.pct)),
    pc.bold(colorPct(summary.functions.pct)),
    summary.depth ? pc.bold(`max depth ${summary.depth.maxDepth}`) : "",
    pc.bold(`${summary.lines.covered}/${summary.lines.total} lines, ${summary.files.length} files`),
  ]);

  const lines = [table.toString()];
  if (limitToLeastCovered && shown.length < rows.length) {
    lines.push(
      pc.dim(
        `  (showing ${shown.length} with the most uncovered lines of ${rows.length}; omit --top for the full table)`,
      ),
    );
  }
  if (summary.worklist && summary.worklist.length > 0) {
    lines.push("", formatWorklist(summary.worklist, options.top ?? 15));
  }
  if (summary.depth) lines.push("", formatDepthSection(summary.depth));
  if (summary.depth && summary.depth.branchGaps.length > 0) {
    lines.push("", formatBranchGaps(summary.depth.branchGaps));
  }
  if (summary.depth && summary.depth.edgeCases.length > 0) {
    lines.push("", formatEdgeCases(summary.depth.edgeCases));
  }
  if (summary.interactions) lines.push("", formatInteractionSection(summary.interactions));
  if (options.mutations !== false && summary.depth && summary.depth.mutations.length > 0) {
    lines.push("", formatMutations(summary.depth.mutations));
  }

  return lines.join("\n");
};

const KIND_LABEL: Record<WorklistItem["kind"], string> = {
  branch: "branch",
  "deep-gap": "depth",
  interaction: "combo",
  edge: "edge",
  mutation: "mutant",
};

/**
 * Render the unified worklist: every analysis merged into one priority-ranked
 * queue of concrete tests to write, deepest and highest-value first. This is the
 * lead "do this next" view; the detailed sections below it carry the same items
 * grouped by signal. Shows the top `limit` rows.
 */
const formatWorklist = (worklist: WorklistItem[], limit: number): string => {
  const shown = worklist.slice(0, limit);
  const headline = pc.bold(
    `Next tests to write  ${pc.dim(`(ranked across all signals: ${shown.length} of ${worklist.length})`)}`,
  );
  const table = new Table({
    head: [pc.bold("#"), pc.bold("Location"), pc.bold("Kind"), pc.bold("Do this")],
    colAligns: ["right", "left", "left", "left"],
    style: { head: [], border: [] },
  });
  shown.forEach((item, index) => {
    table.push([
      pc.dim(String(index + 1)),
      pc.dim(formatLocation(item, item.script)),
      KIND_LABEL[item.kind],
      item.action,
    ]);
  });
  return `${headline}\n${table.toString()}`;
};

/**
 * Render the run-to-run delta: how many worklist items a new test closed, how
 * many newly opened, and how many carry over. Lists the opened items, since a
 * new gap appearing is the surprising thing worth a look.
 */
export const formatWorklistDelta = (delta: WorklistDelta): string => {
  const headline = pc.bold(
    `Progress since baseline  ${pc.dim("(")}${pc.green(`closed ${delta.closed.length}`)} ${pc.dim("·")} ${pc.yellow(`opened ${delta.opened.length}`)} ${pc.dim("·")} ${delta.carried.length} carried${pc.dim(")")}`,
  );
  if (delta.opened.length === 0) return headline;
  const table = new Table({
    head: [pc.bold("Opened"), pc.bold("Kind"), pc.bold("Do this")],
    colAligns: ["left", "left", "left"],
    style: { head: [], border: [] },
  });
  for (const item of delta.opened.slice(0, 15)) {
    table.push([pc.dim(formatLocation(item, item.script)), KIND_LABEL[item.kind], item.action]);
  }
  return `${headline}\n${table.toString()}`;
};

/**
 * Render proven assertion gaps: manifest mutants a mutation-testing run confirmed
 * survive the suite. The branch runs, but no assertion noticed the operator flip,
 * so these are the sharpest "add an assertion here" targets, deepest-first.
 */
export const formatSurvivors = (survivors: Mutation[]): string => {
  const headline = pc.bold(
    `Proven assertion gaps  ${pc.dim(`(manifest mutants that survived the suite: ${survivors.length})`)}`,
  );
  if (survivors.length === 0)
    return `${headline}\n${pc.dim("  none — every targeted mutant was killed")}`;
  const table = new Table({
    head: [pc.bold("Location"), pc.bold("Condition"), pc.bold("Survived mutant")],
    colAligns: ["left", "left", "left"],
    style: { head: [], border: [] },
  });
  for (const mutation of survivors) {
    table.push([
      pc.dim(formatLocation(mutation, mutation.script)),
      mutation.condition,
      `${mutation.original} ${pc.dim("→")} ${pc.bold(mutation.mutated)}`,
    ]);
  }
  return `${headline}\n${table.toString()}`;
};

/**
 * Render the half-covered-branch worklist: decisions that executed but only ever
 * took some arms. Each row reads "at file:line, condition C never went =arm" —
 * the single most direct "write a test that does X" signal, ranked deepest-first.
 */
const formatBranchGaps = (branchGaps: BranchGap[]): string => {
  const headline = pc.bold(
    `Half-covered branches  ${pc.dim(`(reached, but one arm never taken: ${branchGaps.length} shown)`)}`,
  );
  const table = new Table({
    head: [pc.bold("Location"), pc.bold("Condition"), pc.bold("Never =")],
    colAligns: ["left", "left", "left"],
    style: { head: [], border: [] },
  });
  for (const gap of branchGaps) {
    table.push([pc.dim(formatLocation(gap, gap.script)), gap.condition, pc.bold(gap.arm)]);
  }
  return `${headline}\n${table.toString()}`;
};

/**
 * Render the synthesized edge-case worklist: boundary and null/undefined inputs a
 * reached decision's condition implies a test should exercise. Each row reads "at
 * file:line, for condition C, vary x around the boundary" — values V8 coverage
 * can't see, surfaced from the condition's structure and ranked deepest-first.
 */
const formatEdgeCases = (edgeCases: EdgeCase[]): string => {
  const headline = pc.bold(
    `Edge cases  ${pc.dim(`(boundary + null/undefined inputs the conditions imply: ${edgeCases.length} shown)`)}`,
  );
  const table = new Table({
    head: [pc.bold("Location"), pc.bold("Condition"), pc.bold("Try")],
    colAligns: ["left", "left", "left"],
    style: { head: [], border: [] },
  });
  for (const edge of edgeCases) {
    table.push([pc.dim(formatLocation(edge, edge.script)), edge.condition, edge.hint]);
  }
  return `${headline}\n${table.toString()}`;
};

/**
 * Render the targeted mutation manifest: operator mutants a faithful test should
 * kill, read off reached decisions. Each row reads "at file:line, mutate `>` to
 * `>=`"; a `~` in the status column flags a decision not yet covered both ways,
 * where covering the untaken arm comes before testing sensitivity. Ranked
 * deepest-first and intended to seed a coverage-filtered mutation-testing run.
 */
const formatMutations = (mutations: Mutation[]): string => {
  const headline = pc.bold(
    `Mutation manifest  ${pc.dim(`(operator mutants a faithful test should kill: ${mutations.length} shown)`)}`,
  );
  const table = new Table({
    head: [pc.bold("Location"), pc.bold("Condition"), pc.bold("Mutate"), pc.bold("Covered")],
    colAligns: ["left", "left", "left", "left"],
    style: { head: [], border: [] },
  });
  for (const mutation of mutations) {
    table.push([
      pc.dim(formatLocation(mutation, mutation.script)),
      mutation.condition,
      `${mutation.original} ${pc.dim("→")} ${pc.bold(mutation.mutated)}`,
      mutation.bothArmsCovered ? pc.green("both") : pc.yellow("~one"),
    ]);
  }
  return `${headline}\n${table.toString()}`;
};

/**
 * Render the control-flow depth section: per-script branch-edge coverage, how
 * deep into the guard-nesting tests reached vs. how deep it goes, and the
 * deepest unreached spot — "your specs only get 2 levels into a 6-level file".
 */
const formatDepthSection = (depth: DepthSummary): string => {
  const table = new Table({
    head: [
      pc.bold("Script"),
      pc.bold("Weighted%"),
      pc.bold("Branch%"),
      pc.bold("Depth"),
      pc.bold("Deep blocks"),
      pc.bold("Deepest gap"),
    ],
    colAligns: ["left", "right", "right", "right", "right", "left"],
    style: { head: [], border: [] },
  });

  for (const script of depth.scripts) {
    table.push([
      elideHead(basename(script.script), FILE_COLUMN_MAX_WIDTH),
      colorPct(script.weightedCoverage.pct),
      colorPct(script.branchEdges.pct),
      `${script.depthReached}/${script.maxDepth}`,
      `${script.deepBlocks.covered}/${script.deepBlocks.total}`,
      pc.dim(formatGap(script.deepestGap)),
    ]);
  }

  table.push([
    pc.bold("All scripts"),
    pc.bold(colorPct(depth.weightedCoverage.pct)),
    pc.bold(colorPct(depth.branchEdges.pct)),
    pc.bold(`${depth.depthReached}/${depth.maxDepth}`),
    pc.bold(`${depth.deepBlocks.covered}/${depth.deepBlocks.total}`),
    pc.bold(""),
  ]);

  const headline = pc.bold(
    `Control-flow depth  ${pc.dim("(depth-weighted branch coverage:")} ${colorPct(depth.weightedCoverage.pct)}%${pc.dim(")")}`,
  );
  return `${headline}\n${table.toString()}`;
};

/**
 * Render the interaction (combinatorial) section: the pairwise coverage score
 * plus a worklist of uncovered outcome-combinations. Each target reads as "these
 * two independent conditions were each tested both ways, but never in this
 * combination together" — a concrete, source-anchored test to add.
 */
const formatInteractionSection = (interactions: InteractionSummary): string => {
  const headline = pc.bold(
    `Interaction coverage  ${pc.dim("(independent decision combos:")} ${colorPct(interactions.pairs.pct)}%${pc.dim(` — ${interactions.pairs.covered}/${interactions.pairs.total})`)}`,
  );

  if (interactions.targets.length === 0) {
    return `${headline}\n${pc.dim("  all feasible combinations covered")}${formatHotDecisionSection(interactions.hotDecisions)}`;
  }

  const table = new Table({
    head: [pc.bold("Script"), pc.bold("Untested combination"), pc.bold("Depth")],
    colAligns: ["left", "left", "right"],
    style: { head: [], border: [] },
  });

  for (const target of interactions.targets) {
    const left = `${pc.dim(formatLocation(target.a, target.script))} ${target.a.label} ${pc.bold(`=${target.a.arm}`)}`;
    const right = `${pc.dim(formatLocation(target.b, target.script))} ${target.b.label} ${pc.bold(`=${target.b.arm}`)}`;
    const combo = `${left}  ${pc.dim("×")}  ${right}`;
    table.push([
      elideHead(basename(target.script), FILE_COLUMN_MAX_WIDTH),
      combo,
      `${target.depth}`,
    ]);
  }

  return `${headline}\n${table.toString()}${formatHotDecisionSection(interactions.hotDecisions)}`;
};

/**
 * Render stress-test candidates: decisions whose peak per-test hit count ran at
 * a scale where branch coverage stops being a performance signal. Each row
 * reads as "this condition ran N times in one test — measure it under load".
 */
const formatHotDecisionSection = (hotDecisions: HotDecisionTarget[]): string => {
  if (hotDecisions.length === 0) return "";
  const headline = pc.bold(
    `Stress-test candidates  ${pc.dim("(decisions firing at scale within one test)")}`,
  );
  const table = new Table({
    head: [pc.bold("Script"), pc.bold("Hot decision"), pc.bold("Peak hits/test")],
    colAligns: ["left", "left", "right"],
    style: { head: [], border: [] },
  });
  for (const target of hotDecisions) {
    table.push([
      elideHead(basename(target.script), FILE_COLUMN_MAX_WIDTH),
      `${pc.dim(formatLocation(target, target.script))} ${target.label}`,
      target.hits.toLocaleString("en-US"),
    ]);
  }
  return `\n\n${headline}\n${table.toString()}`;
};
