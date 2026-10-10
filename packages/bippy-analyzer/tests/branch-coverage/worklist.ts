import type { CoverageSummary, WorklistDelta, WorklistItem } from "./report.js";

// Signal-type weight, the tiebreaker once guard depth is equal. A surviving
// mutant on a both-ways-covered branch is the sharpest signal (the branch runs
// but no assertion pins it), then a concrete untaken arm, then a combinatorial
// gap, then an unreached deep block, then a synthesized boundary, and last a
// mutant on a branch not yet covered both ways (cover the arm first).
const KIND_WEIGHT = {
  "mutation-both": 5,
  branch: 4,
  interaction: 4,
  "deep-gap": 3,
  edge: 2,
  "mutation-one": 1,
} as const;

// Depth dominates the ranking (it is the package's whole thesis: deeper gaps are
// rarer and harder to hit by accident), so it is scaled past the max kind weight
// and the signal type only orders items at the same depth.
const priorityOf = (depth: number, weight: number): number => depth * 10 + weight;

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const locationKey = (item: { file?: string; script: string; line: number }): string =>
  `${item.file ?? basename(item.script)}:${item.line}`;

/**
 * Merge every analysis into one priority-ranked queue of concrete tests to write.
 * Each source worklist is already deduped and capped; this unifies and re-ranks
 * them so an agent reads a single "do this next" list instead of five tables.
 * Returns `[]` when no depth analysis ran. Stable `id`s let a caller diff runs.
 */
export const buildWorklist = (summary: CoverageSummary): WorklistItem[] => {
  const depth = summary.depth;
  if (!depth) return [];
  const items: WorklistItem[] = [];

  for (const gap of depth.branchGaps) {
    items.push({
      id: `branch:${locationKey(gap)}:${gap.arm}`,
      kind: "branch",
      script: gap.script,
      file: gap.file,
      line: gap.line,
      depth: gap.depth,
      priority: priorityOf(gap.depth, KIND_WEIGHT.branch),
      action: `drive \`${gap.condition}\` to ${gap.arm}`,
      condition: gap.condition,
    });
  }

  // The deepest unreached block per script: "add a spec that gets here".
  for (const script of depth.scripts) {
    const gap = script.deepestGap;
    if (!gap) continue;
    items.push({
      id: `deep-gap:${gap.file ?? basename(script.script)}:${gap.line}`,
      kind: "deep-gap",
      script: script.script,
      file: gap.file,
      line: gap.line,
      depth: gap.depth,
      priority: priorityOf(gap.depth, KIND_WEIGHT["deep-gap"]),
      action: `add a spec that reaches this depth-${gap.depth} block`,
    });
  }

  if (summary.interactions) {
    for (const target of summary.interactions.targets) {
      items.push({
        id: `interaction:${target.a.file ?? basename(target.script)}:${target.a.line}:${target.a.arm}×${target.b.line}:${target.b.arm}`,
        kind: "interaction",
        script: target.script,
        file: target.a.file,
        line: target.a.line,
        depth: target.depth,
        priority: priorityOf(target.depth, KIND_WEIGHT.interaction),
        action: `drive \`${target.a.label}\`=${target.a.arm} together with \`${target.b.label}\`=${target.b.arm}`,
      });
    }
  }

  for (const edge of depth.edgeCases) {
    items.push({
      id: `edge:${locationKey(edge)}:${edge.hint}`,
      kind: "edge",
      script: edge.script,
      file: edge.file,
      line: edge.line,
      depth: edge.depth,
      priority: priorityOf(edge.depth, KIND_WEIGHT.edge),
      action: edge.hint,
      condition: edge.condition,
    });
  }

  for (const mutation of depth.mutations) {
    const weight = mutation.bothArmsCovered
      ? KIND_WEIGHT["mutation-both"]
      : KIND_WEIGHT["mutation-one"];
    items.push({
      id: `mutation:${locationKey(mutation)}:${mutation.original}>${mutation.mutated}`,
      kind: "mutation",
      script: mutation.script,
      file: mutation.file,
      line: mutation.line,
      depth: mutation.depth,
      priority: priorityOf(mutation.depth, weight),
      action: mutation.bothArmsCovered
        ? `add an assertion that fails when \`${mutation.original}\` becomes \`${mutation.mutated}\``
        : `cover both arms, then assert against \`${mutation.original}\` → \`${mutation.mutated}\``,
      condition: mutation.condition,
    });
  }

  return items.sort(
    (left, right) =>
      right.priority - left.priority || locationKey(left).localeCompare(locationKey(right)),
  );
};

/**
 * Diff two worklists by stable `id` to show progress across runs: what a new
 * test closed, what newly opened (a regression or freshly-reached code), and
 * what is still carried. `current` wins for the item bodies, so `carried` and
 * `opened` carry up-to-date priority/action text.
 */
export const diffWorklist = (previous: WorklistItem[], current: WorklistItem[]): WorklistDelta => {
  const previousIds = new Set(previous.map((item) => item.id));
  const currentIds = new Set(current.map((item) => item.id));
  return {
    closed: previous.filter((item) => !currentIds.has(item.id)),
    opened: current.filter((item) => !previousIds.has(item.id)),
    carried: current.filter((item) => previousIds.has(item.id)),
  };
};
