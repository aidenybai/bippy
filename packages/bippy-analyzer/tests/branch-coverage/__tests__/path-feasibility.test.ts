import { describe, expect, it } from "vite-plus/test";
import { isPathFeasible } from "../cfg/path/feasibility.js";
import { constAtomOf, valueAtom } from "../cfg/path/literal-facts.js";
import type { Atom, PathFact } from "../cfg/path/literal-facts.js";
import { lowerGuard } from "../cfg/path/path-condition.js";
import { MAX_PATH_CLAUSES } from "../cfg/constants.js";
import type { EsTreeNode } from "../cfg/ast/es-tree-node.js";
import { analyzeSsaFixture } from "./run-ssa.js";

// The bounded path-feasibility checker, its abstract domain, and the
// lowering of branch guards into facts.

const x = valueAtom("x");
const y = valueAtom("y");

describe("isPathFeasible / contradiction detection", () => {
  it("a value required both truthy and falsy is infeasible", () => {
    const facts: PathFact[] = [
      { kind: "truthy", atom: x, polarity: true },
      { kind: "truthy", atom: x, polarity: false },
    ];
    expect(isPathFeasible(facts)).toBe("infeasible");
  });

  it("a value equated to two distinct constants is infeasible", () => {
    const one = constAtomOf(1)!;
    const two = constAtomOf(2)!;
    const facts: PathFact[] = [
      { kind: "equality", left: x, right: one, polarity: true },
      { kind: "equality", left: x, right: two, polarity: true },
    ];
    expect(isPathFeasible(facts)).toBe("infeasible");
  });

  it("equal and not-equal between the same atoms is infeasible", () => {
    const facts: PathFact[] = [
      { kind: "equality", left: x, right: y, polarity: true },
      { kind: "equality", left: x, right: y, polarity: false },
    ];
    expect(isPathFeasible(facts)).toBe("infeasible");
  });

  it("truthy x while x === 0 is infeasible (constant truthiness)", () => {
    const zero = constAtomOf(0)!;
    const facts: PathFact[] = [
      { kind: "truthy", atom: x, polarity: true },
      { kind: "equality", left: x, right: zero, polarity: true },
    ];
    expect(isPathFeasible(facts)).toBe("infeasible");
  });

  it("independent constraints are feasible", () => {
    const facts: PathFact[] = [
      { kind: "truthy", atom: x, polarity: true },
      { kind: "truthy", atom: y, polarity: false },
    ];
    expect(isPathFeasible(facts)).toBe("feasible");
  });

  it("returns unknown past the clause cap", () => {
    const facts: PathFact[] = Array.from({ length: MAX_PATH_CLAUSES + 1 }, (_unused, index) => ({
      kind: "truthy" as const,
      atom: valueAtom(`distinct${index}`),
      polarity: true,
    }));
    expect(isPathFeasible(facts)).toBe("unknown");
  });
});

const resolveValueFrom =
  (fixture: ReturnType<typeof analyzeSsaFixture>) =>
  (node: EsTreeNode): Atom | null => {
    const identifier = fixture.ssa.versionAt(node);
    return identifier ? valueAtom(`${identifier.binding}#${identifier.version}`) : null;
  };

describe("lowerGuard over SSA values (correlated branches)", () => {
  it("the same unreassigned value at two branches lowers to one atom", () => {
    const fixture = analyzeSsaFixture(`
      function f(x) {
        if (x) {
          first();
        }
        if (x) {
          second();
        }
      }
    `);
    const resolveValue = resolveValueFrom(fixture);
    // The two `if (x)` tests, in source order.
    const firstTest = fixture.identifier("x#2");
    const secondTest = fixture.identifier("x#3");
    // Taking the first branch true and the second false is impossible.
    const facts = [
      ...lowerGuard(firstTest, true, resolveValue),
      ...lowerGuard(secondTest, false, resolveValue),
    ];
    expect(isPathFeasible(facts)).toBe("infeasible");
    // Taking both branches the same way is fine.
    expect(
      isPathFeasible([
        ...lowerGuard(firstTest, true, resolveValue),
        ...lowerGuard(secondTest, true, resolveValue),
      ]),
    ).toBe("feasible");
  });

  it("equality guards refute mismatched constants across branches", () => {
    const fixture = analyzeSsaFixture(`
      function f(x) {
        if (x === 1) {
          first();
        }
        if (x === 2) {
          second();
        }
      }
    `);
    const resolveValue = resolveValueFrom(fixture);
    const firstTest = fixture.identifier("x#2").parent as EsTreeNode;
    const secondTest = fixture.identifier("x#3").parent as EsTreeNode;
    const facts = [
      ...lowerGuard(firstTest, true, resolveValue),
      ...lowerGuard(secondTest, true, resolveValue),
    ];
    expect(isPathFeasible(facts)).toBe("infeasible");
  });

  it("does NOT lower loose `==` to an identity fact (it would be unsound)", () => {
    // `x == 0 && x` is satisfiable (e.g. `x = []`), so the guard must not let
    // the checker prove it infeasible. `==` yields no fact at all.
    const fixture = analyzeSsaFixture(`
      function f(x) {
        if (x == 0) {
          first();
        }
      }
    `);
    const resolveValue = resolveValueFrom(fixture);
    const looseTest = fixture.identifier("x#2").parent as EsTreeNode;
    expect(lowerGuard(looseTest, true, resolveValue)).toEqual([]);
  });
});
