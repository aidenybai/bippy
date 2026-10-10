import type { CoverageSummary, Mutation, MutationPlan } from "./report.js";

// Our condition-mutation kinds map onto these Stryker mutator names. Relational
// and equality operator flips are both Stryker's `EqualityOperator`; `&&`/`||`
// flips are `LogicalOperator`. A consumer enables only these, so the run stays
// scoped to the operators we actually target.
const MUTATOR_FOR_KIND: Record<Mutation["kind"], string> = {
  relational: "EqualityOperator",
  equality: "EqualityOperator",
  logical: "LogicalOperator",
};

/**
 * Turn the mutation manifest into a tool-agnostic plan a mutation tester can run.
 * The `mutate` patterns scope the run to exactly the reached, depth-ranked
 * decisions we track (so it stays tractable on a browser/e2e suite instead of
 * mutating whole files), `mutators` names the operators those conditions imply,
 * and `targets` is the ranked list the suite is expected to kill. Pure synthesis
 * from the summary; returns empty arrays when no depth analysis ran or nothing
 * source-mapped (a mutation tester needs source paths, not bundle coordinates).
 */
export const buildMutationPlan = (summary: CoverageSummary): MutationPlan => {
  const targets = summary.depth?.mutations ?? [];
  const mutate = new Set<string>();
  const mutators = new Set<string>();
  for (const target of targets) {
    // Only first-party, source-mapped decisions are runnable: a mutation tester
    // edits source files, so a bundle-coordinate target (no `file`) is skipped.
    if (target.file) mutate.add(`${target.file}:${target.line}`);
    mutators.add(MUTATOR_FOR_KIND[target.kind]);
  }
  return {
    mutate: [...mutate].sort(),
    mutators: [...mutators].sort(),
    targets,
  };
};
