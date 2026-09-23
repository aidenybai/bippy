import { describe, expect, it } from "vite-plus/test";
import type { ComparisonReport, WildcardAbsorption } from "../src/harness/compare.js";
import {
  formatComparisonReport,
  formatGuardCoverageLines,
  formatStateConditions,
  formatStateReplay,
  formatSymbolicTree,
  rankWildcards,
} from "../src/harness/format-report.js";
import type { GuardCoverage, GuardSideCoverage } from "../src/harness/guard-coverage.js";
import type { StateReplaySummary } from "../src/harness/state-replay.js";
import {
  enumerateStateSpace,
  type DecisionCondition,
  type StateCondition,
  type StateOmission,
  type StateSpaceSummary,
  type StaticState,
} from "../src/harness/state-space.js";
import { anonymousRepeat, choiceBranch, patternHost } from "./helpers/pattern-builders.js";

const longPath = ["app", "main", "section", "list", "item", "card", "title"].join(" > ");

const divergence = {
  path: longPath,
  expected: "<Title>",
  actual: "<Heading>",
};

const coverage = (status: GuardSideCoverage["status"], count: number): GuardCoverage => ({
  sides: Array.from({ length: count }, (_, index): GuardSideCoverage => ({
    kind: "branch",
    variable: `choice-${index}`,
    reason: `reason ${index}`,
    location: index % 2 === 0 ? `file.tsx:${index + 1}:1` : null,
    side: index,
    guard: "true",
    status,
  })),
  witnessed: 0,
  possible: status === "possible" ? count : 0,
  unreachable: status === "unreachable" ? count : 0,
});

const emptyCoverage: GuardCoverage = { sides: [], witnessed: 0, possible: 0, unreachable: 0 };

const decision = (kind: DecisionCondition["kind"], index: number): DecisionCondition => {
  switch (kind) {
    case "branch":
      return {
        kind,
        variable: `branch-${index}`,
        reason: "role",
        location: "page.tsx:4:1",
        alternativeIndex: index,
        alternativeCount: 2,
      };
    case "state-update":
      return {
        kind,
        variable: `state-${index}`,
        reason: "setOpen",
        location: null,
        alternativeIndex: 1,
        alternativeCount: 2,
      };
    case "repeat":
      return { kind, variable: `items-${index}`, location: "list.tsx:2:1", count: index };
  }
};

const condition = (kind: StateCondition["kind"], index: number): StateCondition =>
  kind === "transition" ? { kind, commit: index, commitCount: 3 } : decision(kind, index);

const state = (index: number): StaticState => ({
  tree: [],
  conditions: [condition("branch", index)],
});

const report = (overrides: Partial<ComparisonReport> = {}): ComparisonReport => ({
  status: "partial",
  coverage: 0.5,
  matchedFibers: 2,
  matchedText: 1,
  runtimeFibers: 6,
  staticFibers: 4,
  branchesResolved: 1,
  repeatIterations: 0,
  opaqueSubtrees: 0,
  opaqueSkippedFibers: 0,
  opaqueRenamed: 0,
  slotsMatched: 0,
  slotsUnmatched: 0,
  unmatchedSlots: [],
  wildcardAbsorbedFibers: 0,
  wildcards: [],
  transparentFibers: 0,
  divergence: null,
  stepsUsed: 12,
  budgetExhausted: false,
  strictCoverage: 0.5,
  ...overrides,
});

const summary = (overrides: Partial<StateSpaceSummary> = {}): StateSpaceSummary => ({
  states: 1,
  stateCount: 1,
  clusters: 1,
  tree: { nodes: 1, inputs: 0, guards: 0, branches: 0, repeats: 0, opaque: 0, wildcards: 0 },
  matchedState: null,
  closestState: null,
  omitted: null,
  coverage: emptyCoverage,
  ...overrides,
});

const omissions = (): StateOmission[] => [
  {
    kind: "branch",
    variable: "role",
    reason: "role",
    location: "page.tsx:4:1",
    alternativeIndex: 1,
    conditions: [condition("state-update", 0), condition("transition", 1)],
  },
  {
    kind: "repeat",
    variable: "items",
    location: null,
    countsAbove: 2,
    max: null,
    conditions: [],
  },
  {
    kind: "repeat",
    variable: "rows",
    location: "list.tsx:8:1",
    countsAbove: 1,
    max: 4,
    conditions: [condition("repeat", 3)],
  },
  { kind: "state", conditions: [] },
  { kind: "subtree", reason: "portal was not rendered" },
];

describe("comparison report formatting", () => {
  it("ranks wildcards by the fibers they absorbed and keeps the largest", () => {
    const wildcards: WildcardAbsorption[] = [1, 4, 2, 9, 3, 8].map((absorbedFibers) => ({
      path: "main",
      reason: `reason ${absorbedFibers}`,
      absorbedFibers,
      heads: [],
    }));
    expect(rankWildcards(wildcards, 3).map((wildcard) => wildcard.absorbedFibers)).toEqual([
      9, 8, 4,
    ]);
  });

  it("prints exhausted steps, shortened paths, extra wildcard heads, and unmatched slots", () => {
    const rendered = formatComparisonReport(
      report({
        budgetExhausted: true,
        divergence: divergence,
        wildcards: [
          {
            path: longPath,
            reason: "dynamic children",
            absorbedFibers: 6,
            heads: ["<a>", "<b>", "<c>", "<d>"],
          },
        ],
        unmatchedSlots: [
          {
            path: "main > slot",
            reason: "passed children",
            head: "<Slot>",
            skippedFibers: 3,
            divergence: null,
          },
          {
            path: longPath,
            reason: "renamed slot",
            head: "<Other>",
            skippedFibers: 1,
            divergence,
          },
        ],
      }),
    );
    expect(rendered).toContain("steps: 12 (budget exhausted)");
    expect(rendered).toContain(
      "divergence at … > main > section > list > item > card > title: expected <Title>, saw <Heading>",
    );
    expect(rendered).toContain(
      "6 fibers ?unknown(dynamic children) at … > main > section > list > item > card > title: <a>, <b>, <c>, …",
    );
    expect(rendered).toContain("unmatched slots:");
    expect(rendered).toContain("3 fibers under <Slot> at main > slot (passed children)");
    expect(rendered).toContain("furthest: … > main > section > list > item > card > title");
  });

  it("prints a state space whose match sits outside the enumeration", () => {
    const states = Array.from({ length: 10 }, (_, index) => state(index));
    const rendered = formatComparisonReport(
      report(),
      summary({
        states: 10,
        stateCount: 14,
        omitted: { total: 8, omissions: omissions() },
        matchedState: { index: null, conditions: [condition("transition", 2)] },
        closestState: { index: 20, divergence },
        coverage: coverage("possible", 13),
      }),
      states,
    );
    expect(rendered).toContain("states: 14 in 1 clusters, 10 enumerated (incomplete)");
    expect(rendered).toContain("possible guard sides (13):");
    expect(rendered).toContain("… and 1 more");
    expect(rendered).toContain(
      "matched state: outside the enumerated set commit 3 of 3",
    );
    expect(rendered).toContain("closest state: #21 (unconditional)");
    expect(rendered).toContain("unobserved states (10):");
    expect(rendered).toContain("omitted (8):");
    expect(rendered).toContain(
      "branch(role) @page.tsx:4:1 alternative |1 not expanded under state-update(setOpen) = |1 of 2, commit 2 of 3 (state budget)",
    );
    expect(rendered).toContain("repeat counts above ×2 not enumerated (unbounded)");
    expect(rendered).toContain(
      "repeat @list.tsx:8:1 counts above ×1 not enumerated under repeat @list.tsx:2:1 = ×3 (up to ×4, state budget)",
    );
    expect(rendered).toContain("state (unconditional) not recorded (state budget)");
    expect(rendered).toContain("subtree not materialized: portal was not rendered");
    expect(rendered).toContain("… and 3 more");
  });

  it("names an enumerated match and unreachable guard sides", () => {
    const rendered = formatComparisonReport(
      report({ budgetExhausted: false, divergence: null, wildcards: [], unmatchedSlots: [] }),
      summary({
        states: 1,
        stateCount: 1,
        matchedState: { index: 0, conditions: [condition("branch", 0)] },
        coverage: coverage("unreachable", 1),
      }),
      [state(0)],
    );
    expect(rendered).toContain("states: 1 in 1 clusters");
    expect(rendered).not.toContain("enumerated");
    expect(rendered).toContain("matched state: #1 branch(role) @page.tsx:4:1 = |0 of 2");
    expect(rendered).toContain("unreachable guard sides (1):");
    expect(rendered).not.toContain("unobserved states");
    expect(rendered).not.toContain("(budget exhausted)");
  });

  it("prints a sampled replay, an unrecorded verification, and incomplete assignments", () => {
    const replay: StateReplaySummary = {
      states: 4,
      assignments: 4,
      replayed: 2,
      maxReplayed: 2,
      mismatched: [
        {
          stateIndices: [0],
          conditions: [decision("branch", 0)],
          claimedCommits: 1,
          replayedCommits: 2,
          divergence,
          isCorrected: false,
        },
        {
          stateIndices: [1],
          conditions: [decision("repeat", 2)],
          claimedCommits: 2,
          replayedCommits: 2,
          divergence,
          isCorrected: true,
        },
      ],
      incomplete: [
        {
          stateIndices: [2],
          conditions: [decision("state-update", 0)],
          unresolvedClaimCommits: [0, 2],
          isReplayConcrete: false,
        },
      ],
      matchedOutsideEnumeration: {
        conditions: [condition("transition", 0)],
        verification: "incomplete",
      },
    };
    const rendered = formatStateReplay(replay).join("\n");
    expect(rendered).toContain("replayed: 2 of 4 decision assignments (sampled, max 2), 2 mismatched, 1 incomplete");
    expect(rendered).toContain("verification: unrecorded");
    expect(rendered).toContain(
      "matched outside enumeration: incomplete; commit 1 of 3",
    );
    expect(rendered).toContain("unresolved claim commits 1, 3; replay not concrete");
    expect(rendered).toContain("(uncorrected)");
    expect(rendered).toContain("(corrected)");
    const recorded = formatStateReplay({ ...replay, verification: "contradicted", incomplete: undefined });
    expect(recorded.join("\n")).toContain("verification: contradicted");
    expect(recorded.join("\n")).not.toContain("unresolved claim");
  });

  it("formats an empty condition list as unconditional", () => {
    expect(formatStateConditions([])).toBe("(unconditional)");
    expect(formatGuardCoverageLines(emptyCoverage)).toEqual([
      "guards: 0 witnessed, 0 possible, 0 unreachable of 0 guard sides",
    ]);
  });
});

describe("symbolic tree formatting", () => {
  it("prints keys, unnamed hosts, unknown text, repeats, opaque children, and a truncated wildcard", () => {
    const space = enumerateStateSpace([
      [
        {
          kind: "fiber",
          tag: "HostComponent",
          name: null,
          key: "row",
          children: [
            { kind: "text", text: null },
            { kind: "text", text: "hi" },
          ],
        },
        anonymousRepeat("items", [choiceBranch("role", [patternHost("admin")], [patternHost("guest")])]),
        {
          kind: "opaque",
          name: "Chart",
          runtimeNames: null,
          key: null,
          reason: "canvas",
          passedChildren: [patternHost("legend")],
        },
        { kind: "wildcard", reason: "portal", isTruncated: true },
      ],
      [patternHost("next")],
    ]);
    expect(formatSymbolicTree(space.tree)).toBe(
      [
        "inputs (3):",
        "  commit = commit <commit>",
        "  items = items <unknown>",
        "  role = role <unknown>",
        "commit 1 of 2 [eq(choice(commit), 0)]:",
        '  <HostComponent> key="row"',
        "    ?text",
        '    "hi"',
        "  *d1 len(items) in 0..",
        "    ?d2 role",
        "      |0 eq(choice(role), 0) (preferred)",
        "        <admin>",
        "      |1 not(in(choice(role), [0]))",
        "        <guest>",
        "  ?opaque <Chart> (canvas)",
        "    <legend>",
        "  ~wildcard (portal) truncated",
        "decisions (1 independent clusters):",
        "  over items, role: 7 states",
        "    d1×0",
        "    d1×1  d3|0",
        "    d1×1  d3|1",
        "    d1×2  d3|0  d4|0",
        "    d1×2  d3|0  d4|1",
        "    d1×2  d3|1  d4|0",
        "    d1×2  d3|1  d4|1",
        "commit 2 of 2 [eq(choice(commit), 1)]:",
        "  <next>",
      ].join("\n"),
    );
  });

  it("stops the decision table at sixteen rows and marks a budget-truncated cluster", () => {
    const alternatives = Array.from({ length: 17 }, (_, index) => [patternHost(`alt${index}`)]);
    const wide = enumerateStateSpace([[choiceBranch("lane", ...alternatives)]]);
    const wideText = formatSymbolicTree(wide.tree);
    expect(wideText).toContain("… and 1 more");
    expect(wideText).not.toContain("(truncated)");
    const narrow = enumerateStateSpace([
      [choiceBranch("lane", [patternHost("left")], [patternHost("right")])],
    ]);
    expect(formatSymbolicTree(narrow.tree, { maxStates: 1, maxRepeat: 0 })).toContain("(truncated)");
  });

  it("keeps a single commit under the tree heading", () => {
    const space = enumerateStateSpace([[patternHost("only")]]);
    expect(formatSymbolicTree(space.tree)).toContain("\ntree:\n  <only>");
  });
});
