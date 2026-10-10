import {
  armFired,
  armLabel,
  armProbe,
  collectConditionMutations,
  collectEdgeCases,
  conditionLabel,
  isDeadArm,
  isThirdPartyFile,
  makeCountAt,
  nodeStart,
  prepareScript,
  representativeOffset,
} from "./cfg-shared.js";
import type {
  ConditionEdge,
  LineIndex,
  OffsetMapper,
  PreparedFunction,
  PreparedScript,
  V8Function,
} from "./cfg-shared.js";
import { DEPTH_WEIGHT_BASE, MAX_BRANCH_GAPS, MAX_EDGE_CASES, MAX_MUTATIONS } from "./constants.js";
import { sumMetrics, toMetric } from "./report.js";
import type { BranchGap, DepthSummary, EdgeCase, Mutation, ScriptDepth } from "./report.js";
import { dedupeBy } from "./utils/dedupe-by.js";
import { resolveLocation } from "./utils/resolve-location.js";

type PendingBranchGap = Omit<BranchGap, "script">;
type PendingEdgeCase = Omit<EdgeCase, "script">;
type PendingMutation = Omit<Mutation, "script">;

// Turn a structure-derived condition edge into the agent-actionable hint string.
const edgeHint = (edge: ConditionEdge): string =>
  edge.kind === "boundary"
    ? `vary \`${edge.subject}\` around the boundary ${edge.value} (${edge.operator})`
    : `drive \`${edge.subject}\` to null/undefined`;

interface ScriptDepthAccumulator {
  branchCovered: number;
  branchTotal: number;
  maxDepth: number;
  depthReached: number;
  deepCovered: number;
  deepTotal: number;
  weightedCovered: number;
  weightedTotal: number;
  /** Deepest unreached block in first-party (or unmapped) code — the actionable hint. */
  deepestGap?: { line: number; depth: number; file?: string };
  /** Deepest unreached block including bundled dependencies; only used as a last resort. */
  deepestGapFallback?: { line: number; depth: number; file?: string };
  /** Reached decisions with an arm that never fired — the actionable "drive it the other way" list. */
  branchGaps: PendingBranchGap[];
  /** Structure-implied edge cases for reached decisions (boundary + nullish). */
  edgeCases: PendingEdgeCase[];
  /** Targeted operator mutants for reached decisions. */
  mutations: PendingMutation[];
}

const accumulateFunction = (
  prepared: PreparedFunction,
  countAt: (offset: number) => number,
  source: string,
  lineIndex: LineIndex,
  accumulator: ScriptDepthAccumulator,
  mapOffset: OffsetMapper | null,
): void => {
  const { cfg, decisionBlocks, depthOf, liveReachableSet } = prepared;

  // Did V8 ever enter this function? Its interior blocks are all "unreached"
  // until it is called at all, so a never-entered function must not supply the
  // deepest-gap hint — otherwise an unreachable-until-called depth-N interior
  // block outranks the real frontier (a block in a function a test *did* enter).
  const entryOffset = representativeOffset(cfg.entry);
  const functionEntered = entryOffset !== null && countAt(entryOffset) > 0;

  for (const block of decisionBlocks) {
    // A decision nested inside a constant guard's dead arm is itself dead code:
    // it can never execute, so its arms must not inflate branch or weighted
    // totals or appear as gaps. Same rule the deep-block loop applies below.
    if (!liveReachableSet.has(block)) continue;
    // Weight each arm by the guard depth of its decision, so taking a deeply
    // nested branch is worth more than a top-level one. Same universe as the raw
    // branch-edge count, just reweighted — `weighted < branch` means the missed
    // arms are the deep ones.
    const depth = depthOf(block);
    const armWeight = DEPTH_WEIGHT_BASE + depth;
    const blockOffset = representativeOffset(block);
    const decisionReached = blockOffset !== null && countAt(blockOffset) > 0;
    const untakenArms: string[] = [];
    // `armIndex` counts cond/backedge edges in order so it matches `armLabel`
    // and the index `isDeadArm` uses for expression branches. It must advance
    // for every such edge, including a dead one we skip, or later arms would be
    // mislabeled.
    let armIndex = -1;
    for (const edge of block.successors) {
      if (edge.kind !== "cond" && edge.kind !== "backedge") continue;
      armIndex++;
      // A compile-time-constant guard (`if (false)`, `false && x`) has an arm
      // that can never be taken. That arm is dead code, not an untested branch,
      // so it must not count toward branch totals or appear in the gap worklist.
      if (isDeadArm(block.terminal, edge, armIndex)) continue;
      accumulator.branchTotal++;
      accumulator.weightedTotal += armWeight;
      // Honest per-arm execution: an expression arm probes its own sub-expression
      // count, never the borrowed downstream merge hit. See `armProbe`.
      const armCovered = armFired(armProbe(block.terminal, edge, armIndex), countAt);
      // Fold the arm target's structural depth into the depth aggregates. The
      // block loop below measures depth only on instruction-bearing blocks, but
      // expression-branch arms (a ternary's `p()`/`q()`, a `&&` right operand)
      // are empty blocks, so their nesting would otherwise be invisible. maxDepth
      // is "deepest nesting that exists" (unconditional). depthReached is "deepest
      // nesting a test actually ran", so it folds only when the arm genuinely
      // fired — and `armCovered` here is the honest per-arm probe, not the old
      // borrowed downstream hit, so an unexecuted deep arm can no longer inflate
      // it. For a statement `if` the arm target is the body block the loop
      // already counts, so neither value moves there.
      const armDepth = depthOf(edge.to);
      if (armDepth > accumulator.maxDepth) accumulator.maxDepth = armDepth;
      if (armCovered) {
        accumulator.branchCovered++;
        accumulator.weightedCovered += armWeight;
        if (armDepth > accumulator.depthReached) accumulator.depthReached = armDepth;
      } else if (edge.kind === "cond") {
        // A backedge that didn't fire just means the loop ran once — not an
        // actionable gap. A `cond` arm that never fired is a real half-covered
        // branch worth a test.
        untakenArms.push(armLabel(block.terminal, edge, armIndex));
      }
    }

    // Only surface decisions that actually executed: an unreached decision is
    // dead code (already visible in line coverage), whereas a reached one that
    // only ever went one way is the gold target — "drive the other arm".
    if (decisionReached && untakenArms.length > 0) {
      const { file, line } = resolveLocation(mapOffset, lineIndex, blockOffset);
      const condition = conditionLabel(block, source);
      for (const arm of untakenArms) {
        accumulator.branchGaps.push({ line, file, condition, arm, depth });
      }
    }

    // Edge cases and mutants the decision's *structure* implies. Only for reached
    // decisions: an unreached one is already a line/branch gap, so synthesizing
    // inputs or mutants for it would be noise. Both are derived from the condition
    // AST (values are invisible to V8), ranked deepest-first like the gaps.
    if (decisionReached) {
      const edges = collectEdgeCases(block.terminal, source);
      const mutations = collectConditionMutations(block.terminal);
      if (edges.length > 0 || mutations.length > 0) {
        const { file, line } = resolveLocation(mapOffset, lineIndex, blockOffset);
        const condition = conditionLabel(block, source);
        for (const edge of edges) {
          accumulator.edgeCases.push({
            line,
            file,
            condition,
            kind: edge.kind,
            hint: edgeHint(edge),
            depth,
          });
        }
        // A decision exercised both ways makes its mutant a genuine sensitivity
        // test; one with an untaken arm needs the branch covered first.
        const bothArmsCovered = untakenArms.length === 0;
        for (const mutation of mutations) {
          accumulator.mutations.push({
            line,
            file,
            depth,
            condition,
            kind: mutation.kind,
            original: mutation.original,
            mutated: mutation.mutated,
            bothArmsCovered,
          });
        }
      }
    }
  }

  for (const block of cfg.blocks) {
    if (block.instructions.length === 0) continue;
    // A block reachable only through a constant guard's dead arm can never run,
    // so it is a line-coverage fact, not a depth gap — don't let it be counted
    // or reported as the deepest "add a spec here" target.
    if (!liveReachableSet.has(block)) continue;
    const offset = nodeStart(block.instructions[0]!.node);
    const executed = countAt(offset) > 0;
    const depth = depthOf(block);

    if (depth > accumulator.maxDepth) accumulator.maxDepth = depth;
    if (executed && depth > accumulator.depthReached) accumulator.depthReached = depth;

    if (depth >= 1) {
      accumulator.deepTotal++;
      if (executed) {
        accumulator.deepCovered++;
      } else if (functionEntered) {
        // Only an entered function's unreached block is an honest "go deeper"
        // gap. A never-entered function's interior blocks are skipped here and
        // surfaced once at the function entry below.
        const { file, line } = resolveLocation(mapOffset, lineIndex, offset);
        const gap = { line, depth, file };
        if (!accumulator.deepestGapFallback || depth > accumulator.deepestGapFallback.depth) {
          accumulator.deepestGapFallback = gap;
        }
        if (
          !isThirdPartyFile(file) &&
          (!accumulator.deepestGap || depth > accumulator.deepestGap.depth)
        ) {
          accumulator.deepestGap = gap;
        }
      }
    }
  }

  // A function V8 never entered still has uncovered code worth a test, but the
  // actionable target is "call/render this function", not "reach its depth-N
  // interior" (unreachable until it runs at all). Surface it once at the entry,
  // depth 1, so recall is preserved without a misleading deep target — and so an
  // entered function's genuinely deeper gap (depth > 1) always outranks it.
  if (!functionEntered && entryOffset !== null) {
    const { file, line } = resolveLocation(mapOffset, lineIndex, entryOffset);
    const gap = { line, depth: 1, file };
    if (!accumulator.deepestGapFallback) accumulator.deepestGapFallback = gap;
    if (!isThirdPartyFile(file) && !accumulator.deepestGap) accumulator.deepestGap = gap;
  }
};

/**
 * Measure how deep into its control-flow structure the V8 coverage actually
 * reached, from an already-parsed script. Best-effort: an empty CFG yields
 * `null`. Coverage must never fail because depth analysis did.
 */
export const accumulateScriptDepth = (
  prepared: PreparedScript,
  script: string,
  source: string,
  v8Functions: unknown[],
  mapOffset: OffsetMapper | null = null,
): ScriptDepth | null => {
  const countAt = makeCountAt(v8Functions as V8Function[]);
  const accumulator: ScriptDepthAccumulator = {
    branchCovered: 0,
    branchTotal: 0,
    maxDepth: 0,
    depthReached: 0,
    deepCovered: 0,
    deepTotal: 0,
    weightedCovered: 0,
    weightedTotal: 0,
    branchGaps: [],
    edgeCases: [],
    mutations: [],
  };

  for (const fn of prepared.functions) {
    accumulateFunction(fn, countAt, source, prepared.lineIndex, accumulator, mapOffset);
  }

  if (accumulator.branchTotal === 0 && accumulator.deepTotal === 0) return null;

  return {
    script,
    branchEdges: toMetric(accumulator.branchCovered, accumulator.branchTotal),
    maxDepth: accumulator.maxDepth,
    depthReached: accumulator.depthReached,
    deepBlocks: toMetric(accumulator.deepCovered, accumulator.deepTotal),
    weightedCoverage: toMetric(accumulator.weightedCovered, accumulator.weightedTotal),
    deepestGap: accumulator.deepestGap ?? accumulator.deepestGapFallback,
    branchGaps: accumulator.branchGaps.map((gap) => ({ script, ...gap })),
    edgeCases: accumulator.edgeCases.map((edge) => ({ script, ...edge })),
    mutations: accumulator.mutations.map((mutation) => ({ script, ...mutation })),
  };
};

/** Parse one served script, then run {@link accumulateScriptDepth} on it. */
export const analyzeScriptDepth = (
  script: string,
  source: string,
  v8Functions: unknown[],
  mapOffset: OffsetMapper | null = null,
): ScriptDepth | null => {
  const prepared = prepareScript(script, source);
  if (!prepared) return null;
  return accumulateScriptDepth(prepared, script, source, v8Functions, mapOffset);
};

/** Roll per-script depth up into the overall summary. */
export const summarizeDepth = (scripts: ScriptDepth[]): DepthSummary => {
  // Bundled dependencies aren't yours to test, so keep the worklist first-party
  // (and unmapped) — same rule as the deepest-gap hint — then collapse the same
  // branch appearing across code-split bundles (keyed by source when mapped),
  // keeping the deepest occurrence after the depth-then-line sort.
  const branchGaps = dedupeBy(
    scripts
      .flatMap((script) => script.branchGaps)
      .filter((gap) => !isThirdPartyFile(gap.file))
      .sort((left, right) => right.depth - left.depth || left.line - right.line),
    (gap) => `${gap.file ?? gap.script}:${gap.line}:${gap.arm}`,
  ).slice(0, MAX_BRANCH_GAPS);
  // Same first-party filter, deepest-first rank, and cap as the branch worklist;
  // dedupe by location + the specific hint so the same boundary isn't repeated
  // across code-split bundles.
  const edgeCases = dedupeBy(
    scripts
      .flatMap((script) => script.edgeCases)
      .filter((edge) => !isThirdPartyFile(edge.file))
      .sort((left, right) => right.depth - left.depth || left.line - right.line),
    (edge) => `${edge.file ?? edge.script}:${edge.line}:${edge.hint}`,
  ).slice(0, MAX_EDGE_CASES);
  // One mutant per operator per location, deepest-first, first-party only.
  const mutations = dedupeBy(
    scripts
      .flatMap((script) => script.mutations)
      .filter((mutation) => !isThirdPartyFile(mutation.file))
      .sort((left, right) => right.depth - left.depth || left.line - right.line),
    (mutation) =>
      `${mutation.file ?? mutation.script}:${mutation.line}:${mutation.kind}:${mutation.original}`,
  ).slice(0, MAX_MUTATIONS);
  return {
    branchEdges: sumMetrics(scripts.map((script) => script.branchEdges)),
    maxDepth: Math.max(0, ...scripts.map((script) => script.maxDepth)),
    depthReached: Math.max(0, ...scripts.map((script) => script.depthReached)),
    deepBlocks: sumMetrics(scripts.map((script) => script.deepBlocks)),
    weightedCoverage: sumMetrics(scripts.map((script) => script.weightedCoverage)),
    branchGaps,
    edgeCases,
    mutations,
    scripts,
  };
};
