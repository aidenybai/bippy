import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import { enumerateStates } from "../src/harness/enumerate-states.js";
import { formatSymbolicTree } from "../src/harness/format-report.js";
import { computeGuardCoverage } from "../src/harness/guard-coverage.js";
import { evaluateGuard, solveGuards, toWitnessModel } from "../src/harness/guard-solver.js";
import type { RuntimeFiberSnapshot } from "../src/harness/snapshot.js";
import {
  enumerateStateSpace,
  matchStateSpace,
  type StateCondition,
} from "../src/harness/state-space.js";
import type { PatternNode } from "../src/harness/static-pattern.js";
import {
  andGuard,
  compareGuard,
  constantGuard,
  equalsGuard,
  formatGuard,
  negateGuard,
  orGuard,
  parseSymbolicTree,
  truthyGuard,
  type Guard,
  type InputVariable,
  type SymbolicVariable,
} from "../src/harness/symbolic-tree.js";
import { planWitnesses, witnessPlanSchema } from "../src/harness/witness-plan.js";
import { createStaticRenderer } from "../src/index.js";
import { COMPONENTS_DIRECTORY } from "./helpers/component-runner.js";
import { guardedBranch, input, patternHost } from "./helpers/pattern-builders.js";

const host = (name: string, children: RuntimeFiberSnapshot[] = []): RuntimeFiberSnapshot => ({
  tag: "HostComponent",
  name,
  key: null,
  text: null,
  props: {},
  children,
});

const variable = (inputId: string, ...path: string[]): SymbolicVariable => ({
  input: inputId,
  path,
  measure: "value",
});

const length = (inputId: string, ...path: string[]): SymbolicVariable => ({
  input: inputId,
  path,
  measure: "length",
});

const user = input("user", "fetch");

const describeState = (conditions: StateCondition[]): string =>
  conditions
    .map((condition) => {
      switch (condition.kind) {
        case "branch":
        case "state-update":
          return `${condition.reason}|${condition.alternativeIndex}`;
        case "repeat":
          return `${condition.variable}×${condition.count}`;
        case "transition":
          return `commit${condition.commit}`;
      }
    })
    .join(" ");

const itemsRepeat = (
  items: SymbolicVariable,
  inputs: InputVariable[],
  children: PatternNode[],
): PatternNode => ({
  kind: "repeat",
  variable: "items",
  decision: "items",
  location: null,
  cardinality: { ...items, measure: "length" },
  inputs,
  scopedInputs: [],
  count: { min: 0, max: null },
  children,
});

const renderFixture = async (name: string) => {
  const renderer = await createStaticRenderer({
    rootDirectory: COMPONENTS_DIRECTORY,
    tsconfigPath: join(COMPONENTS_DIRECTORY, "tsconfig.json"),
  });
  return enumerateStaticStates(await renderer.renderComponent(join(COMPONENTS_DIRECTORY, name)));
};

describe("symbolic tree: correlation by construction", () => {
  it("names one input for every guard derived from the same unknown, across siblings and depth", async () => {
    const space = await renderFixture("correlated-guards.tsx");
    expect(space.tree.inputs.map((candidate) => candidate.source)).toEqual(["unknown"]);
    const [commit] = space.commitStates;
    expect(commit.clusters).toHaveLength(1);
    expect(space.stateCount).toBe(5);
    const states = space.states.map((state) => describeState(state.conditions));
    expect(states).toHaveLength(5);
    for (const state of states) {
      if (state.includes("branch(<boolean> | false)|0")) {
        expect(state).toContain("| undefined)|0");
      }
    }
    expect(space.omitted).toBeNull();
    expect(formatSymbolicTree(space.tree)).toContain('eq(#1.listeners.("viewer").0.role, "admin")');
  });
});

describe("symbolic tree: input provenance", () => {
  it("names the source of every input and keeps an optional input's tests on one variable", async () => {
    const space = await renderFixture("input-provenance.tsx");
    expect(space.tree.inputs.map((candidate) => [candidate.source, candidate.label])).toEqual([
      ["environment", "process.env.FIXTURE_FEATURE"],
      ["storage", "localStorage.getItem with a dynamic key"],
      ["random", "Math.random"],
    ]);
    const [commit] = space.commitStates;
    expect(commit.clusters.map((cluster) => cluster.states.length)).toEqual([3, 2, 2]);
    expect(space.stateCount).toBe(12);
    const rendered = formatSymbolicTree(space.tree);
    expect(rendered).toContain('and(not(eq(typeof(#1), "undefined")), eq(#1, "beta"))');
    expect(rendered).toContain("#3 < 0.5");
  });
});

describe("symbolic tree: guard algebra", () => {
  const isTruthy = truthyGuard(variable("#1"));
  const isBeta = equalsGuard(variable("#2", "flag"), "beta");

  it("folds a guard next to its own negation to the absorbing constant", () => {
    expect(andGuard([isTruthy, negateGuard(isTruthy)])).toEqual(constantGuard(false));
    expect(orGuard([isBeta, negateGuard(isBeta)])).toEqual(constantGuard(true));
    expect(andGuard([isTruthy, orGuard([isBeta, negateGuard(isBeta)])])).toEqual(isTruthy);
  });

  it("collapses duplicate operands and keeps distinct ones", () => {
    expect(andGuard([isTruthy, isTruthy])).toEqual(isTruthy);
    expect(orGuard([isTruthy, isBeta, isTruthy])).toEqual({
      kind: "or",
      operands: [isTruthy, isBeta],
    });
  });

  it("decides a test whose branch is truthy exactly when it is taken", async () => {
    const space = await renderFixture("narrowed-opaque-portal-root.tsx");
    expect(space.tree.inputs).toHaveLength(0);
    expect(formatSymbolicTree(space.tree)).not.toContain("truthy(");
  });
});

describe("symbolic tree: guard literals", () => {
  it("keeps every guard literal finite so the tree survives JSON serialization", async () => {
    const space = await renderFixture("infinite-bound.tsx");
    const rendered = formatSymbolicTree(space.tree);
    expect(rendered).toContain("#2 < 50");
    expect(rendered).toContain("truthy(#1)");
    expect(rendered).not.toContain("Infinity");
    expect(parseSymbolicTree(JSON.stringify(space.tree))).toEqual(space.tree);
  });
});

describe("symbolic tree: independent guards factor", () => {
  const admin = guardedBranch(
    "admin",
    equalsGuard(variable("user", "role"), "admin"),
    [user],
    [patternHost("button")],
    [],
  );
  const theme = input("theme", "storage");
  const dark = guardedBranch(
    "dark",
    equalsGuard(variable("theme"), "dark"),
    [theme],
    [patternHost("moon")],
    [patternHost("sun")],
  );

  it("enumerates 2 + 2 cluster states and 4 whole states from a tree of two branches", () => {
    const one = enumerateStateSpace([[patternHost("main", [admin])]]);
    const both = enumerateStateSpace([[patternHost("main", [admin, dark])]]);
    expect(both.commitStates[0].clusters.map((cluster) => cluster.states.length)).toEqual([2, 2]);
    expect(both.stateCount).toBe(4);
    expect(both.states).toHaveLength(4);
    expect(both.tree.stats.nodes - one.tree.stats.nodes).toBe(3);
    expect(both.tree.stats.branches).toBe(2);
    expect(both.tree.inputs.map((candidate) => candidate.id)).toEqual(["user", "theme"]);
  });

  it("keeps guards over one input in one cluster and drops contradictory combinations", () => {
    const named = guardedBranch(
      "named",
      truthyGuard(variable("user", "role")),
      [user],
      [patternHost("em")],
      [patternHost("i")],
    );
    const space = enumerateStateSpace([[patternHost("main", [admin, named])]]);
    expect(space.commitStates[0].clusters).toHaveLength(1);
    expect(space.states.map((state) => describeState(state.conditions))).toEqual([
      "admin|0 named|0",
      "admin|1 named|0",
      "admin|1 named|1",
    ]);
  });
});

describe("symbolic tree: repeat cardinality", () => {
  const items = variable("user", "items");
  const hasItems = guardedBranch(
    "has-items",
    compareGuard(length("user", "items"), ">", 0),
    [user],
    [patternHost("h2")],
    [patternHost("p")],
  );

  it("ties the repeat count to the length of its input", () => {
    const space = enumerateStateSpace([
      [patternHost("main", [hasItems, itemsRepeat(items, [user], [patternHost("li")])])],
    ]);
    expect(space.commitStates[0].clusters).toHaveLength(1);
    expect(space.states.map((state) => describeState(state.conditions))).toEqual([
      "has-items|0 items×1",
      "has-items|0 items×2",
      "has-items|1 items×0",
    ]);
    expect(space.omitted?.omissions.map((omission) => omission.kind)).toEqual(["repeat"]);
  });
});

describe("symbolic tree: deferred commits", () => {
  it("guards every committed tree over the commit input", () => {
    const space = enumerateStateSpace([
      [patternHost("main", [patternHost("progress")])],
      [patternHost("main", [patternHost("output")])],
    ]);
    expect(space.tree.inputs.map((candidate) => candidate.id)).toEqual(["commit"]);
    expect(space.tree.commits.map((commit) => formatGuard(commit.guard))).toEqual([
      "eq(choice(commit), 0)",
      "eq(choice(commit), 1)",
    ]);
    const coverage = computeGuardCoverage(space.tree, [
      [{ kind: "transition", commit: 1, commitCount: 2 }],
    ]);
    expect(coverage.sides.map((side) => `${side.kind}|${side.side} ${side.status}`)).toEqual([
      "commit|0 possible",
      "commit|1 witnessed",
    ]);
  });
});

describe("symbolic tree: membership without full enumeration", () => {
  const toggles = Array.from({ length: 10 }, (_, index) =>
    guardedBranch(
      `toggle${index}`,
      truthyGuard(variable(`flag${index}`)),
      [input(`flag${index}`, "feature-flag")],
      [patternHost(`on${index}`)],
      [patternHost(`off${index}`)],
    ),
  );
  const budget = { maxStates: 8, maxRepeat: 2 };
  const space = enumerateStateSpace([[patternHost("main", toggles)]], budget);

  it("counts every state but instantiates only the budget", () => {
    expect(space.stateCount).toBe(1024);
    expect(space.states).toHaveLength(8);
    expect(space.omitted).toEqual({ omissions: [], droppedStates: 1016 });
    expect([...enumerateStates(space.tree, budget)]).toHaveLength(8);
  });

  it("finds a member beyond the instantiated states by solving its guards", () => {
    const runtime = host(
      "main",
      toggles.map((_, index) => host(index % 3 === 0 ? `off${index}` : `on${index}`)),
    );
    const match = matchStateSpace(space, [runtime]);
    expect(match.status).toBe("exact");
    expect(match.matched?.index).toBeNull();
    expect(match.matched?.conditions.map((condition) => describeState([condition]))).toEqual(
      toggles.map((_, index) => `toggle${index}|${index % 3 === 0 ? 1 : 0}`),
    );
  });

  it("rejects a runtime tree no guard assignment reaches", () => {
    const runtime = host("main", [host("on0"), host("on1"), host("on2")]);
    expect(matchStateSpace(space, [runtime]).status).toBe("mismatch");
  });
});

const nested = (): PatternNode[] => [
  patternHost("main", [
    guardedBranch(
      "admin",
      equalsGuard(variable("user", "role"), "admin"),
      [user],
      [
        guardedBranch(
          "guest",
          equalsGuard(variable("user", "role"), "guest"),
          [user],
          [patternHost("never")],
          [patternHost("settings")],
        ),
      ],
      [patternHost("home")],
    ),
  ]),
];

describe("guard solver", () => {
  const notGuard = (operand: Guard): Guard => ({ kind: "not", operand });
  const sectionGuard = (section: string): Guard =>
    orGuard([
      andGuard([
        truthyGuard(variable("panel", "visibility")),
        truthyGuard(variable("panel", "visibility", section)),
      ]),
      notGuard(truthyGuard(variable("panel", "visibility"))),
    ]);

  const guards = Array.from({ length: 64 }, (_, index) =>
    orGuard([
      equalsGuard(variable("settings", `flag${index}`), false),
      notGuard(truthyGuard(variable("settings", "enabled"))),
    ]),
  ).concat(
    Array.from({ length: 64 }, (_, index) => sectionGuard(`section${index}`)),
    truthyGuard(variable("settings", "enabled")),
  );
  const either = orGuard([
    equalsGuard(variable("panel", "mode"), "curves"),
    equalsGuard(variable("settings", "tab"), 1),
  ]);

  it("finds a model of many disjunctions that every guard accepts", () => {
    const witnesses = solveGuards([...guards, either]);
    expect(witnesses).not.toBeNull();
    const model = toWitnessModel(witnesses ?? []);
    for (const guard of [...guards, either]) expect(evaluateGuard(guard, model)).toBe(true);
  });

  it("refutes contradictory atoms before splitting the disjunctions' product", () => {
    const started = performance.now();
    expect(
      solveGuards([...guards, equalsGuard(variable("settings", "enabled"), false)]),
    ).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("splits a disjunction only against the conjuncts sharing its variables", () => {
    const started = performance.now();
    expect(
      solveGuards([
        ...guards,
        notGuard(equalsGuard(variable("panel", "mode"), "curves")),
        andGuard([notGuard(equalsGuard(variable("settings", "tab"), 1))]),
        either,
      ]),
    ).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
    expect(
      solveGuards([either, notGuard(equalsGuard(variable("panel", "mode"), "curves"))]),
    ).not.toBeNull();
  });
});

describe("guard coverage", () => {
  it("reports each guard side as witnessed, possible or unreachable", () => {
    const space = enumerateStateSpace([nested()]);
    const match = matchStateSpace(space, [host("main", [host("settings")])]);
    expect(match.status).toBe("exact");
    const coverage = computeGuardCoverage(space.tree, [match.matched?.conditions ?? []]);
    expect(coverage.sides.map((side) => `${side.variable}|${side.side} ${side.status}`)).toEqual([
      "admin|0 witnessed",
      "guest|0 unreachable",
      "guest|1 witnessed",
      "admin|1 possible",
    ]);
    expect(coverage).toMatchObject({ witnessed: 2, possible: 1, unreachable: 1 });
    expect(computeGuardCoverage(space.tree, []).witnessed).toBe(0);
  });
});

describe("witness planning", () => {
  it("covers every reachable side with input assignments and lists the unreachable ones", () => {
    const space = enumerateStateSpace([nested()]);
    const plan = planWitnesses(space.tree);
    expect(plan.unreachable.map((side) => side.key)).toEqual(["guest|0"]);
    expect(plan.uncovered).toEqual([]);
    const covered = plan.witnesses.flatMap((witness) => witness.covers.map((side) => side.key));
    expect(covered.sort()).toEqual(["admin|0", "admin|1", "guest|1"]);
    expect(plan.witnesses).toHaveLength(2);
    for (const witness of plan.witnesses) {
      expect(witness.assignments.map((assignment) => assignment.input)).toEqual([user]);
      expect(witness.assignments[0].variable).toEqual(variable("user", "role"));
    }
    expect(witnessPlanSchema.parse(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });
});

describe("formatSymbolicTree", () => {
  it("prints inputs with provenance, guards inline and a decision table per cluster", () => {
    const space = enumerateStateSpace([nested()]);
    const rendered = formatSymbolicTree(space.tree);
    expect(rendered).toBe(
      [
        "inputs (1):",
        "  user = user <fetch>",
        "tree:",
        "  <main>",
        "    ?d1 admin",
        '      |0 eq(user.role, "admin") (preferred)',
        "        ?d2 guest",
        '          |0 eq(user.role, "guest") (preferred)',
        "            <never>",
        '          |1 not(eq(user.role, "guest"))',
        "            <settings>",
        '      |1 not(eq(user.role, "admin"))',
        "        <home>",
        "decisions (1 independent clusters):",
        "  over user: 2 states",
        "    d1|0  d2|1",
        "    d1|1",
      ].join("\n"),
    );
    expect(parseSymbolicTree(JSON.stringify(space.tree))).toEqual(space.tree);
  });

  it("keeps opaque and wildcard leaves explicit", () => {
    const space = enumerateStateSpace([
      [
        patternHost("main", [
          {
            kind: "opaque",
            name: "Chart",
            runtimeNames: null,
            key: null,
            reason: "canvas",
            passedChildren: [],
          },
          { kind: "wildcard", reason: "unknown children", isTruncated: false },
        ]),
      ],
    ]);
    const rendered = formatSymbolicTree(space.tree);
    expect(rendered).toContain("?opaque <Chart> (canvas)");
    expect(rendered).toContain("~wildcard (unknown children)");
    expect(space.tree.stats).toMatchObject({ opaque: 1, wildcards: 1 });
  });
});
