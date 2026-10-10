import { analyzeSsa, isPathFeasible, lowerGuard, ssaValueResolver } from "./cfg/index.js";
import type { BasicBlock, DominatorTree, EsTreeNode, ResolveValueAtom } from "./cfg/index.js";
import {
  armFired,
  armLabel,
  armProbe,
  conditionLabel,
  directControllers,
  makeCountAt,
  representativeOffset,
  testNodeOf,
} from "./cfg-shared.js";
import type {
  ArmProbe,
  LineIndex,
  OffsetMapper,
  PreparedFunction,
  PreparedScript,
  V8Function,
} from "./cfg-shared.js";
import {
  HOT_DECISION_MIN_HITS_PER_TEST,
  MAX_DECISIONS_FOR_PAIRING,
  MAX_HOT_DECISION_TARGETS,
  MAX_INTERACTION_TARGETS,
} from "./constants.js";
import { toMetric } from "./report.js";
import type { HotDecisionTarget, InteractionSummary, InteractionTarget } from "./report.js";
import { dedupeBy } from "./utils/dedupe-by.js";
import { resolveLocation } from "./utils/resolve-location.js";

// One arm of a decision: the probe whose V8 hit-count tells us "was this arm
// taken?" (an expression arm probes its own sub-expression, never the borrowed
// merge hit), plus a human label (true/false/enter/exit/...).
interface DecisionArm {
  probe: ArmProbe;
  label: string;
}

// A binary control-flow decision in a function, with both arms and a readable
// condition snippet. Only binary (2-arm) decisions participate in interactions.
interface Decision {
  id: number;
  /** Source file (source-mapped) when a map resolved, else the served script. */
  file?: string;
  /** Source line when mapped, else the served-script line. */
  line: number;
  label: string;
  depth: number;
  arms: DecisionArm[];
  /** Controlling test expression, for feasibility lowering (null when none). */
  testNode: EsTreeNode | null;
}

// Map an arm's outcome label to the truthiness its decision's test must hold for
// that arm. Used to lower the arm into a path fact. `null` for arms whose
// outcome doesn't reduce to a single truthiness (switch cases, optional chains),
// which simply opts that combination out of feasibility pruning (kept as-is).
const armPolarity = (label: string): boolean | null => {
  switch (label) {
    case "true":
    case "enter":
    case "truthy":
      return true;
    case "false":
    case "exit":
    case "falsy":
      return false;
    default:
      return null;
  }
};

// Candidate interaction = two *independent* binary decisions (neither nested in
// the other). Nested combinations are already captured by depth.
interface CandidatePair {
  a: Decision;
  b: Decision;
}

interface FunctionModel {
  decisions: Decision[];
  candidatePairs: CandidatePair[];
}

export interface ScriptInteractionModel {
  script: string;
  source: string;
  functions: FunctionModel[];
  /**
   * Resolves a test-expression identifier to its SSA value atom, so two
   * decisions reading the same value lower to the same atom and a contradictory
   * combination can be proven infeasible. `null` when feasibility pruning is off
   * or SSA could not be built; pruning is then skipped (every target kept).
   */
  resolveValue: ResolveValueAtom | null;
}

const armsOf = (block: BasicBlock): DecisionArm[] => {
  const arms: DecisionArm[] = [];
  let index = 0;
  for (const edge of block.successors) {
    if (edge.kind !== "cond" && edge.kind !== "backedge") continue;
    arms.push({
      probe: armProbe(block.terminal, edge, index),
      label: armLabel(block.terminal, edge, index),
    });
    index++;
  }
  return arms;
};

// Transitive control-dependence ancestors of a decision, as a set of decision
// ids. Two decisions are *independent* when neither is in the other's ancestor
// set — i.e. they sit on parallel branches rather than nested ones.
const transitiveControllerIds = (
  decisionBlocks: BasicBlock[],
  postDominators: DominatorTree,
  idOf: Map<BasicBlock, number>,
): Map<number, Set<number>> => {
  const memo = new Map<number, Set<number>>();
  const inProgress = new Set<number>();
  const ancestorsOf = (block: BasicBlock): Set<number> => {
    const id = idOf.get(block)!;
    const cached = memo.get(id);
    if (cached) return cached;
    if (inProgress.has(id)) return new Set();
    inProgress.add(id);
    const result = new Set<number>();
    for (const controller of directControllers(block, decisionBlocks, postDominators)) {
      result.add(idOf.get(controller)!);
      for (const grand of ancestorsOf(controller)) result.add(grand);
    }
    inProgress.delete(id);
    memo.set(id, result);
    return result;
  };

  const all = new Map<number, Set<number>>();
  for (const block of decisionBlocks) all.set(idOf.get(block)!, ancestorsOf(block));
  return all;
};

const buildFunctionModel = (
  prepared: PreparedFunction,
  source: string,
  lineIndex: LineIndex,
  nextId: () => number,
  mapOffset: OffsetMapper | null,
): FunctionModel => {
  const { decisionBlocks, postDominators, depthOf } = prepared;

  const idOf = new Map<BasicBlock, number>();
  for (const block of decisionBlocks) idOf.set(block, nextId());

  const decisions: Decision[] = decisionBlocks.map((block) => {
    const { file, line } = resolveLocation(mapOffset, lineIndex, representativeOffset(block) ?? 0);
    return {
      id: idOf.get(block)!,
      file,
      line,
      label: conditionLabel(block, source),
      depth: depthOf(block),
      arms: armsOf(block),
      testNode: testNodeOf(block.terminal),
    };
  });

  const candidatePairs: CandidatePair[] = [];
  // Only binary decisions pair, and only when the function is small enough that
  // the O(n^2) pairing stays cheap. Larger functions still count toward depth.
  const binary = decisions.filter((decision) => decision.arms.length === 2);
  if (binary.length <= MAX_DECISIONS_FOR_PAIRING) {
    const ancestors = transitiveControllerIds(decisionBlocks, postDominators, idOf);
    for (let i = 0; i < binary.length; i++) {
      for (let j = i + 1; j < binary.length; j++) {
        const a = binary[i]!;
        const b = binary[j]!;
        const aControlsB = ancestors.get(b.id)?.has(a.id) ?? false;
        const bControlsA = ancestors.get(a.id)?.has(b.id) ?? false;
        if (aControlsB || bControlsA) continue;
        candidatePairs.push({ a, b });
      }
    }
  }

  return { decisions, candidatePairs };
};

// Build the SSA-backed atom resolver for one script's parsed program, so the
// feasibility check can tell whether two decisions read the same value. SSA is
// best-effort: a failure (or a pathological program) yields `null`, which
// disables pruning for the script — never an error, never a hidden target.
const buildResolveValue = (program: EsTreeNode): ResolveValueAtom | null => {
  try {
    return ssaValueResolver(analyzeSsa(program));
  } catch {
    return null;
  }
};

export const buildModelFromPrepared = (
  prepared: PreparedScript,
  script: string,
  source: string,
  mapOffset: OffsetMapper | null = null,
  pruneInfeasible = false,
): ScriptInteractionModel | null => {
  let counter = 0;
  const nextId = (): number => counter++;
  const functions: FunctionModel[] = [];
  for (const fn of prepared.functions) {
    functions.push(buildFunctionModel(fn, source, prepared.lineIndex, nextId, mapOffset));
  }
  if (functions.every((fn) => fn.candidatePairs.length === 0)) return null;
  const resolveValue = pruneInfeasible ? buildResolveValue(prepared.program) : null;
  return { script, source, functions, resolveValue };
};

// Accumulates per-test observations across the whole run: which arms each
// decision took (individually) and which arm *combinations* of each candidate
// pair co-occurred in a single test.
interface PairAccumulator {
  pair: CandidatePair;
  observed: Set<string>;
}

interface ScriptAccumulator {
  model: ScriptInteractionModel;
  individualArms: Map<number, Set<number>>;
  pairs: PairAccumulator[];
  decisions: Decision[];
  peakHitsPerTest: Map<number, number>;
}

const comboKey = (armA: number, armB: number): string => `${armA}:${armB}`;

// Can these two arms ever hold together? Two independent decisions sit on
// parallel branches, so the combined path condition is just the conjunction of
// their two guards; if that conjunction is provably contradictory the
// combination can never be exercised in one test, so it's a phantom gap, not a
// real one. SOUND BY CONSTRUCTION: `isPathFeasible` returns `infeasible` only on
// a proof, so we drop a combination only when proven impossible — `feasible`,
// `unknown`, an unresolved test, or a non-truthiness arm all keep it.
const isInfeasibleCombo = (
  resolveValue: ResolveValueAtom | null,
  a: Decision,
  armA: number,
  b: Decision,
  armB: number,
): boolean => {
  if (!resolveValue || !a.testNode || !b.testNode) return false;
  const polarityA = armPolarity(a.arms[armA]!.label);
  const polarityB = armPolarity(b.arms[armB]!.label);
  if (polarityA === null || polarityB === null) return false;
  const facts = [
    ...lowerGuard(a.testNode, polarityA, resolveValue),
    ...lowerGuard(b.testNode, polarityB, resolveValue),
  ];
  return isPathFeasible(facts) === "infeasible";
};

// Collapse targets that point at the same source decision + arms. A code-split
// app compiles one source file into several bundles, so an identical gap would
// otherwise appear once per bundle and burn slots in the capped worklist. Keyed
// by source location when mapped (so it collapses across bundles), falling back
// to the bundle script when a decision didn't source-map. The two endpoints are
// order-normalized so `a×b` and `b×a` collapse together.
export const dedupeInteractionTargets = (targets: InteractionTarget[]): InteractionTarget[] => {
  const endpointKey = (script: string, side: InteractionTarget["a"]): string =>
    `${side.file ?? script}:${side.line}:${side.arm}`;
  return dedupeBy(targets, (target) =>
    [endpointKey(target.script, target.a), endpointKey(target.script, target.b)].sort().join("×"),
  );
};

interface InteractionAnalyzer {
  observeTest: (script: string, functions: V8Function[]) => void;
  summarize: () => InteractionSummary | null;
}

export const createInteractionAnalyzer = (
  models: ScriptInteractionModel[],
): InteractionAnalyzer => {
  const accumulators = new Map<string, ScriptAccumulator>();
  for (const model of models) {
    const pairs: PairAccumulator[] = [];
    const decisions: Decision[] = [];
    for (const fn of model.functions) {
      for (const pair of fn.candidatePairs) pairs.push({ pair, observed: new Set() });
      for (const decision of fn.decisions) decisions.push(decision);
    }
    accumulators.set(model.script, {
      model,
      individualArms: new Map(),
      pairs,
      decisions,
      peakHitsPerTest: new Map(),
    });
  }

  const observeTest = (script: string, functions: V8Function[]): void => {
    const accumulator = accumulators.get(script);
    if (!accumulator) return;
    const countAt = makeCountAt(functions);

    // Per-test fired arms per decision (a decision can fire several arms across
    // multiple calls within one test, so each arm is tracked independently).
    const firedThisTest = new Map<number, Set<number>>();
    const armsFired = (decision: Decision): Set<number> => {
      const cached = firedThisTest.get(decision.id);
      if (cached) return cached;
      const fired = new Set<number>();
      for (let index = 0; index < decision.arms.length; index++) {
        const arm = decision.arms[index]!;
        if (armFired(arm.probe, countAt)) fired.add(index);
      }
      firedThisTest.set(decision.id, fired);
      // Roll into the run-wide individual record.
      let individual = accumulator.individualArms.get(decision.id);
      if (!individual) {
        individual = new Set();
        accumulator.individualArms.set(decision.id, individual);
      }
      for (const armIndex of fired) individual.add(armIndex);
      return fired;
    };

    for (const { pair, observed } of accumulator.pairs) {
      const firedA = armsFired(pair.a);
      const firedB = armsFired(pair.b);
      if (firedA.size === 0 || firedB.size === 0) continue;
      for (const armA of firedA) {
        for (const armB of firedB) observed.add(comboKey(armA, armB));
      }
    }

    for (const decision of accumulator.decisions) {
      let hitsThisTest = 0;
      for (const arm of decision.arms) {
        if (arm.probe.offset === null) continue;
        const count = countAt(arm.probe.offset);
        if (count > hitsThisTest) hitsThisTest = count;
      }
      const peak = accumulator.peakHitsPerTest.get(decision.id) ?? 0;
      if (hitsThisTest > peak) accumulator.peakHitsPerTest.set(decision.id, hitsThisTest);
    }
  };

  const summarizeHotDecisions = (): HotDecisionTarget[] => {
    const hot: HotDecisionTarget[] = [];
    for (const accumulator of accumulators.values()) {
      for (const decision of accumulator.decisions) {
        const peak = accumulator.peakHitsPerTest.get(decision.id) ?? 0;
        if (peak < HOT_DECISION_MIN_HITS_PER_TEST) continue;
        hot.push({
          script: accumulator.model.script,
          label: decision.label,
          file: decision.file,
          line: decision.line,
          hits: peak,
        });
      }
    }
    hot.sort((left, right) => right.hits - left.hits);
    const deduped = dedupeBy(hot, (target) => `${target.file ?? target.script}:${target.line}`);
    return deduped.slice(0, MAX_HOT_DECISION_TARGETS);
  };

  const summarize = (): InteractionSummary | null => {
    let covered = 0;
    let total = 0;
    const targets: InteractionTarget[] = [];

    for (const accumulator of accumulators.values()) {
      for (const { pair, observed } of accumulator.pairs) {
        const armsA = accumulator.individualArms.get(pair.a.id);
        const armsB = accumulator.individualArms.get(pair.b.id);
        // Feasible only when each decision was demonstrably exercised both ways.
        if (!armsA || !armsB || armsA.size < 2 || armsB.size < 2) continue;

        for (const armA of armsA) {
          for (const armB of armsB) {
            // A provably impossible combination is a phantom gap: don't count it
            // in the denominator and don't ask anyone to cover it.
            if (isInfeasibleCombo(accumulator.model.resolveValue, pair.a, armA, pair.b, armB)) {
              continue;
            }
            total++;
            if (observed.has(comboKey(armA, armB))) {
              covered++;
            } else {
              targets.push({
                script: accumulator.model.script,
                depth: Math.max(pair.a.depth, pair.b.depth),
                a: {
                  label: pair.a.label,
                  file: pair.a.file,
                  line: pair.a.line,
                  arm: pair.a.arms[armA]!.label,
                },
                b: {
                  label: pair.b.label,
                  file: pair.b.file,
                  line: pair.b.line,
                  arm: pair.b.arms[armB]!.label,
                },
              });
            }
          }
        }
      }
    }

    if (total === 0) return null;
    targets.sort((left, right) => right.depth - left.depth || left.a.line - right.a.line);
    return {
      pairs: toMetric(covered, total),
      targets: dedupeInteractionTargets(targets).slice(0, MAX_INTERACTION_TARGETS),
      hotDecisions: summarizeHotDecisions(),
    };
  };

  return { observeTest, summarize };
};
