import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("calling a function chosen by a condition", () => {
  const project = analyzeFixture("conformance-repros", "chosen-callee-guards");

  const getGuardedUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update): [string, string[]] => [
        formatSymbolicValue(update.value),
        update.guards.map(formatSymbolicValue),
      ]),
    );

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  for (const name of ["LocalTernary", "FieldCall"]) {
    it(`${name} records each arm under its test`, () => {
      expect(getGuardedUpdates(name)).toEqual([
        ['"b"', ['pick === "a"']],
        ['"c"', ['!(pick === "a")']],
      ]);
    });
  }

  it("records the swapped arms under the swapped test", () => {
    expect(getGuardedUpdates("SwappedTernary")).toEqual([
      ['"c"', ['pick !== "a"']],
      ['"b"', ['!(pick !== "a")']],
    ]);
  });

  it("records a table entry under its key test", () => {
    expect(getGuardedUpdates("TableCall").map(([value, guards]) => [value, guards.at(-1)])).toEqual(
      [
        ['"b"', 'pick === "a"'],
        ['"c"', 'pick === "b"'],
      ],
    );
  });

  for (const name of ["LocalTernary", "SwappedTernary", "TableCall", "FieldCall"]) {
    it(`${name} moves like the directly passed handler`, () => {
      expect(getTargets(name)).toEqual(getTargets("DirectTernary"));
    });
  }
});
