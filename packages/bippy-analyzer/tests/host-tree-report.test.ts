import { expect, it } from "vite-plus/test";
import {
  createGuardedHostTreeReport,
  specializeGuardedHostTree,
  HostTreeReportError,
  type GuardedHostTreeInput,
  type GuardNot,
  type GuardConstant,
  type HostTreeCommitInput,
  type HostTreeDiagnostic,
} from "../src/index.js";
import { andGuard, constantGuard, negateGuard, truthyGuard } from "../src/symbolic/guards.js";

const enabled = truthyGuard({ input: "enabled", path: [], measure: "value" });
const commit = (
  id: string,
  snapshot: string,
  guard = constantGuard(true),
): GuardedHostTreeInput => ({ id, guard, outcome: { kind: "commit", snapshot } });
const query = (observations: GuardedHostTreeInput[], value: boolean) =>
  specializeGuardedHostTree(
    createGuardedHostTreeReport(["enabled"], observations),
    new Map([["enabled", value]]),
  );

it("preserves whole-tree correlation without mixing props and children", () => {
  const positive = JSON.stringify({
    type: "button",
    props: { disabled: false },
    children: ["Enabled"],
  });
  const negative = JSON.stringify({
    type: "button",
    props: { disabled: true },
    children: ["Disabled"],
  });
  const observations = [
    commit("enabled", positive, enabled),
    commit("disabled", negative, negateGuard(enabled)),
  ];
  for (const value of [false, true])
    expect(query(observations, value)).toEqual({
      kind: "selected",
      observationId: value ? "enabled" : "disabled",
      outcome: { kind: "commit", snapshot: value ? positive : negative },
    });
});

it.each([
  "null",
  "[]",
  '""',
  '"text"',
  '["first","second"]',
  '{"type":"div","props":{},"children":null}',
  '{"type":"div","props":{},"children":[]}',
])("preserves empty, text, forest and child shapes: %s", (snapshot) => {
  const result = query([commit("observation", snapshot)], true);
  expect(result).toEqual({
    kind: "selected",
    observationId: "observation",
    outcome: { kind: "commit", snapshot },
  });
});

it("shares equal content without merging observation identity or sibling positions", () => {
  const tree = { type: "p", props: {}, children: ["same", "same"] };
  const observations = [
    commit("second", JSON.stringify(tree), negateGuard(enabled)),
    commit("first", JSON.stringify(tree), enabled),
  ];
  const report = createGuardedHostTreeReport(["enabled"], observations);
  expect(report.nodes).toHaveLength(2);
  expect(report.nodes[1]).toMatchObject({ children: [0, 0] });
  expect(report.observations.map((observation) => observation.id)).toEqual(["first", "second"]);
  expect(report.observations[0].outcome).toEqual(report.observations[1].outcome);
  expect(JSON.stringify(report)).toBe(
    JSON.stringify(createGuardedHostTreeReport(["enabled"], observations.toReversed())),
  );
  expect(report.execution).toBe("not-verified");
  expect(report.coverage).toBe("not-verified");
});

it("never converts missing observations or overlapping commits to an empty tree", () => {
  expect(query([], true)).toEqual({ kind: "uncovered" });
  expect(query([commit("first", "null", enabled)], false)).toEqual({ kind: "uncovered" });
  expect(query([commit("second", "null"), commit("first", "null")], true)).toEqual({
    kind: "ambiguous",
    observationIds: ["first", "second"],
  });
});

const diagnosticKinds: HostTreeDiagnostic["kind"][] = [
  "throw",
  "unsupported",
  "incomplete",
  "engine-failure",
  "mismatch",
];
it.each(diagnosticKinds)("retains guarded %s separately from a commit", (kind) => {
  const outcome = { kind, name: "OriginalName", message: "Original diagnostic" };
  const observations: GuardedHostTreeInput[] = [
    { id: "failure", guard: enabled, outcome },
    commit("empty", "null", negateGuard(enabled)),
  ];
  expect(query(observations, true)).toEqual({
    kind: "selected",
    observationId: "failure",
    outcome,
  });
  expect(query(observations, false)).toMatchObject({
    kind: "selected",
    outcome: { kind: "commit", snapshot: "null" },
  });
});

it("keeps contradictions and negated conjunctions correlated", () => {
  const observations = [
    commit("impossible", '"bad"', andGuard([enabled, negateGuard(enabled)])),
    commit("false", '"false"', negateGuard(andGuard([enabled, enabled]))),
  ];
  expect(query(observations, true)).toEqual({ kind: "uncovered" });
  expect(query(observations, false)).toMatchObject({ observationId: "false" });
});

it("copies and freezes guards, nodes, props and outcome data", () => {
  const operand: GuardConstant = { kind: "constant", value: true };
  const outcome = {
    kind: "commit",
    snapshot: '{"type":"p","props":{"nested":{"value":1}},"children":["a"]}',
  } satisfies HostTreeCommitInput;
  const observations = [{ id: "first", guard: operand, outcome }];
  const report = createGuardedHostTreeReport([], observations);
  operand.value = false;
  outcome.snapshot = "null";
  expect(specializeGuardedHostTree(report, new Map())).toMatchObject({
    kind: "selected",
    outcome: { kind: "commit" },
  });
  expect(Object.isFrozen(report)).toBe(true);
  expect(Object.isFrozen(report.observations[0].guard)).toBe(true);
  const element = report.nodes.find((node) => node.kind === "element");
  expect(Object.isFrozen(element?.props)).toBe(true);
  expect(Object.isFrozen(element?.props.nested)).toBe(true);
});

it("canonicalizes props without prototype pollution and round-trips a serialized report", () => {
  const report = createGuardedHostTreeReport(
    [],
    [
      commit(
        "first",
        '{"type":"div","props":{"z":1,"__proto__":{"polluted":true},"a":2},"children":null}',
      ),
    ],
  );
  expect(
    Object.getPrototypeOf(report.nodes[0].kind === "element" ? report.nodes[0].props : null),
  ).toBe(null);
  const parsed = JSON.parse(JSON.stringify(report));
  expect(specializeGuardedHostTree(parsed, new Map())).toEqual(
    specializeGuardedHostTree(report, new Map()),
  );
  expect(Reflect.get({}, "polluted")).toBeUndefined();
});

it.each([
  "false",
  "1",
  "{}",
  "[null]",
  '{"type":"p","props":null,"children":null}',
  '{"type":"p","props":{},"children":false}',
  '{"type":"p","props":{},"children":null,"extra":1}',
  '{"type":"p","props":{"value":1e999},"children":null}',
  '{"type":"p","props":{"value":-0},"children":null}',
  "not json",
])("rejects invalid or unrepresentable snapshots: %s", (snapshot) => {
  expect(() => query([commit("first", snapshot)], true)).toThrow(
    expect.objectContaining({ name: "HostTreeReportError", code: "invalid-input" }),
  );
});

it("rejects undeclared inputs, nonempty paths, invalid assignments and duplicate identities", () => {
  expect(() => createGuardedHostTreeReport([], [commit("first", "null", enabled)])).toThrow(
    "declared Boolean",
  );
  expect(() =>
    createGuardedHostTreeReport(
      ["enabled"],
      [
        commit(
          "first",
          "null",
          truthyGuard({ input: "enabled", path: ["ignored"], measure: "value" }),
        ),
      ],
    ),
  ).toThrow("empty paths");
  expect(() => createGuardedHostTreeReport(["enabled", "enabled"], [])).toThrow("Duplicate input");
  expect(() => query([commit("same", "null"), commit("same", "null")], true)).toThrow(
    "Duplicate observation",
  );
  const report = createGuardedHostTreeReport(["enabled"], []);
  expect(() => specializeGuardedHostTree(report, new Map())).toThrow("exactly");
  expect(() => specializeGuardedHostTree(report, new Map([["other", true]]))).toThrow("exactly");
});

it.each([
  { maxObservations: 1 },
  { maxNodes: 1 },
  { maxEntries: 1 },
  { maxDepth: 1 },
  { maxSnapshotCharacters: 1 },
])("throws rather than returning a truncated report when a budget is exhausted: %o", (options) => {
  const observations = [
    commit("first", '{"type":"p","props":{"deep":{"value":1}},"children":["a"]}'),
    commit("second", '"b"'),
  ];
  try {
    createGuardedHostTreeReport([], observations, options);
    throw Error("Expected budget failure");
  } catch (error) {
    expect(error).toBeInstanceOf(HostTreeReportError);
    if (error instanceof HostTreeReportError) expect(error.code).toBe("budget-exceeded");
  }
});

it("does not hide an overlapping diagnostic behind a commit", () => {
  expect(
    query(
      [
        commit("commit", "null"),
        {
          id: "unresolved",
          guard: constantGuard(true),
          outcome: { kind: "unsupported", message: "Missing operation" },
        },
      ],
      true,
    ),
  ).toEqual({ kind: "ambiguous", observationIds: ["commit", "unresolved"] });
});

it("rejects non-string snapshots without coercing or invoking them", () => {
  let calls = 0;
  const snapshot = {
    toString: () => {
      calls++;
      return "null";
    },
  };
  expect(() =>
    Reflect.apply(createGuardedHostTreeReport, undefined, [
      [],
      [{ id: "bad", guard: constantGuard(true), outcome: { kind: "commit", snapshot } }],
    ]),
  ).toThrow("serialized host snapshot");
  expect(calls).toBe(0);
});

it("reads each supplied assignment once before evaluating repeated guards", () => {
  const report = createGuardedHostTreeReport(
    ["enabled"],
    [
      commit("enabled", '"enabled"', enabled),
      commit("disabled", '"disabled"', negateGuard(enabled)),
    ],
  );
  const inputs = new Map([["enabled", true]]);
  let reads = 0;
  inputs.get = () => ++reads === 1;
  expect(specializeGuardedHostTree(report, inputs)).toMatchObject({
    kind: "selected",
    observationId: "enabled",
  });
  expect(reads).toBe(1);
});

it("bounds cyclic guards and rejects unsafe limits", () => {
  const guard: GuardNot = { kind: "not", operand: constantGuard(true) };
  guard.operand = guard;
  expect(() => query([commit("cycle", "null", guard)], true)).toThrow("maxDepth");
  expect(() => createGuardedHostTreeReport([], [], { maxDepth: 129 })).toThrow("cannot exceed");
  expect(() => createGuardedHostTreeReport([], [], { maxNodes: NaN })).toThrow("Invalid maxNodes");
});
