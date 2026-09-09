import { describe, expect, it } from "vite-plus/test";
import type { RuntimeFiberSnapshot } from "../src/harness/snapshot.js";
import {
  enumerateStateSpace,
  matchStateSpace,
  type StateCondition,
} from "../src/harness/state-space.js";
import type {
  PatternBranch,
  PatternFiber,
  PatternNode,
  PatternRepeat,
} from "../src/harness/static-pattern.js";

const host = (name: string, children: RuntimeFiberSnapshot[] = []): RuntimeFiberSnapshot => ({
  tag: "HostComponent",
  name,
  key: null,
  text: null,
  props: {},
  children,
});

const fiber = (name: string, children: PatternNode[] = []): PatternFiber => ({
  kind: "fiber",
  tag: "HostComponent",
  name,
  key: null,
  children,
});

const branch = (variable: string, ...alternatives: PatternNode[][]): PatternBranch => ({
  kind: "branch",
  variable,
  reason: variable,
  location: null,
  preferredIndex: 0,
  alternatives,
});

const repeat = (
  variable: string,
  children: PatternNode[],
  count: PatternRepeat["count"] = { min: 0, max: null },
): PatternRepeat => ({ kind: "repeat", variable, location: null, count, children });

const describeConditions = (conditions: StateCondition[]): string =>
  conditions
    .map((condition) => {
      switch (condition.kind) {
        case "branch":
        case "state-update":
          return `${condition.variable}=${condition.alternativeIndex}`;
        case "repeat":
          return `${condition.variable}×${condition.count}`;
        case "transition":
          return `commit${condition.commit}`;
      }
    })
    .join(" ");

describe("enumerateStateSpace", () => {
  it("multiplies independent decisions and shares correlated ones", () => {
    const independent = enumerateStateSpace([
      [fiber("main", [branch("a", [fiber("x")], [fiber("y")]), branch("b", [fiber("p")], [])])],
    ]);
    expect(independent.states.map((state) => describeConditions(state.conditions))).toEqual([
      "a=0 b=0",
      "a=0 b=1",
      "a=1 b=0",
      "a=1 b=1",
    ]);
    expect(independent.omitted).toBeNull();

    const correlated = enumerateStateSpace([
      [
        fiber("main", [
          fiber("nav", [branch("a", [fiber("x")], [fiber("y")])]),
          branch("a", [fiber("p")], [fiber("q")]),
        ]),
      ],
    ]);
    expect(correlated.states.map((state) => describeConditions(state.conditions))).toEqual([
      "a=0",
      "a=1",
    ]);
    expect(correlated.states[1].tree).toEqual([
      fiber("main", [fiber("nav", [fiber("y")]), fiber("q")]),
    ]);
  });

  it("enumerates repeat cardinalities up to the bound and records the rest as omitted", () => {
    const unbounded = enumerateStateSpace([[fiber("ul", [repeat("r", [fiber("li")])])]]);
    expect(unbounded.states.map((state) => describeConditions(state.conditions))).toEqual([
      "r×0",
      "r×1",
      "r×2",
    ]);
    expect(unbounded.states[2].tree).toEqual([fiber("ul", [fiber("li"), fiber("li")])]);
    expect(unbounded.omitted).toEqual({
      omissions: [
        {
          kind: "repeat",
          variable: "r",
          location: null,
          countsAbove: 2,
          max: null,
          conditions: [],
        },
      ],
    });

    const known = enumerateStateSpace([
      [fiber("ul", [repeat("r", [fiber("li")], { min: 1, max: 2 })])],
    ]);
    expect(known.states.map((state) => describeConditions(state.conditions))).toEqual([
      "r×1",
      "r×2",
    ]);
    expect(known.omitted).toBeNull();
  });

  it("decides a branch inside a repeat once per iteration", () => {
    const space = enumerateStateSpace([
      [fiber("ul", [repeat("r", [branch("a", [fiber("li")], [fiber("dd")])], { min: 2, max: 2 })])],
    ]);
    expect(space.states.map((state) => describeConditions(state.conditions))).toEqual([
      "r×2 a@r[0]=0 a@r[1]=0",
      "r×2 a@r[0]=0 a@r[1]=1",
      "r×2 a@r[0]=1 a@r[1]=0",
      "r×2 a@r[0]=1 a@r[1]=1",
    ]);
  });

  it("stops at the state budget and reports every alternative it could not expand", () => {
    const space = enumerateStateSpace(
      [[fiber("main", [branch("a", [fiber("x")], [fiber("y")]), branch("b", [fiber("p")], [])])]],
      { maxStates: 3, maxRepeat: 2 },
    );
    expect(space.states).toHaveLength(3);
    expect(space.omitted?.omissions.map((omission) => omission.kind)).toEqual(["state"]);
    const [omission] = space.omitted?.omissions ?? [];
    if (omission?.kind !== "state") throw new Error("expected the dropped state to be recorded");
    expect(describeConditions(omission.conditions)).toBe("a=1 b=1");

    const cutEarly = enumerateStateSpace(
      [
        [
          fiber("main", [
            branch("a", [fiber("x")], [fiber("y")]),
            branch("b", [fiber("p")], [fiber("q")]),
            branch("c", [fiber("s")], [fiber("t")]),
          ]),
        ],
      ],
      { maxStates: 2, maxRepeat: 2 },
    );
    expect(cutEarly.states.map((state) => describeConditions(state.conditions))).toEqual([
      "a=0 b=0 c=0",
      "a=0 b=0 c=1",
    ]);
    expect(
      cutEarly.omitted?.omissions.map((omission) =>
        omission.kind === "branch"
          ? `${omission.variable}|${omission.alternativeIndex} under ${describeConditions(omission.conditions)}`
          : `${omission.kind} ${omission.kind === "state" ? describeConditions(omission.conditions) : ""}`,
      ),
    ).toEqual(["state a=0 b=1 c=0", "c|1 under a=0 b=1", "a|1 under "]);
  });

  it("makes each distinct committed tree a state", () => {
    const space = enumerateStateSpace([
      [fiber("main", [fiber("progress")])],
      [fiber("main", [fiber("progress")])],
      [fiber("main", [fiber("output")])],
    ]);
    expect(space.states.map((state) => describeConditions(state.conditions))).toEqual([
      "commit0",
      "commit1",
    ]);
  });
});

describe("matchStateSpace", () => {
  const space = enumerateStateSpace([
    [
      fiber("main", [
        branch("a", [fiber("x")], [fiber("y")]),
        branch("b", [fiber("p")], [fiber("q")]),
      ]),
    ],
  ]);

  it("reports the enumerated state the runtime equals", () => {
    const match = matchStateSpace(space, [host("main", [host("y"), host("p")])]);
    expect(match.status).toBe("exact");
    expect(match.matched).toEqual({
      index: 2,
      conditions: space.states[2].conditions,
    });
    expect(match.closest).toBeNull();
  });

  it("reports a mismatch with the closest state when no state equals the runtime", () => {
    const match = matchStateSpace(space, [host("main", [host("y"), host("z")])]);
    expect(match.status).toBe("mismatch");
    expect(match.matched).toBeNull();
    expect(match.closest?.index).toBe(2);
    expect(match.closest?.divergence.actual).toContain("z");
  });

  it("never reports exact when the space is truncated", () => {
    const truncated = enumerateStateSpace([[fiber("ul", [repeat("r", [fiber("li")])])]]);
    const within = matchStateSpace(truncated, [host("ul", [host("li")])]);
    expect(within.status).toBe("truncated");
    expect(within.matched?.index).toBe(1);

    const beyond = matchStateSpace(truncated, [
      host("ul", [host("li"), host("li"), host("li"), host("li")]),
    ]);
    expect(beyond.status).toBe("truncated");
    expect(beyond.matched?.index).toBeNull();
    expect(describeConditions(beyond.matched?.conditions ?? [])).toBe("r×4");
  });

  it("handles trees far larger than the call stack when the decisions are few", () => {
    const rows = Array.from({ length: 20_000 }, () => fiber("tr", [fiber("td", [fiber("span")])]));
    const runtimeRows = Array.from({ length: 20_000 }, () =>
      host("tr", [host("td", [host("span")])]),
    );
    const space = enumerateStateSpace([
      [fiber("table", [branch("header", [fiber("thead")], []), fiber("tbody", rows)])],
    ]);
    const match = matchStateSpace(space, [host("table", [host("tbody", runtimeRows)])]);
    expect(match.status).toBe("exact");
    expect(describeConditions(match.matched?.conditions ?? [])).toBe("header=1");
  });

  it("matches the runtime against the commit that produced it", () => {
    const commits = enumerateStateSpace([
      [fiber("main", [fiber("progress")])],
      [fiber("main", [fiber("output")])],
    ]);
    const settled = matchStateSpace(commits, [host("main", [host("output")])]);
    expect(settled.matched?.index).toBe(1);
    const early = matchStateSpace(commits, [host("main", [host("progress")])]);
    expect(early.matched?.index).toBe(0);
  });
});
