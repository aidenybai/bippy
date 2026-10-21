import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a handler's write to a render-scoped local", () => {
  const project = analyzeFixture("conformance-repros", "handler-local-writes");

  const getStates = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  for (const name of ["LostLet", "LostField"]) {
    it(`${name} may be lost by the next render`, () => {
      expect(getStates(name)).toEqual([
        ['note === "lost"'],
        ['note !== "lost"', 'note === "kept"'],
        ['note !== "lost"', 'note !== "kept"'],
      ]);
      const { report } = getComponent(project, name);
      const lost = report.states.findIndex((state) => state.conditions.includes('note === "lost"'));
      expect(report.states[2]?.transitions.flatMap((transition) => transition.targets)).toContain(
        lost,
      );
    });
  }

  it("is still seen by the reads that follow it in the same handler", () => {
    const { analysis } = getComponent(project, "SameHandler");
    expect(
      analysis.handlers.flatMap((handler) => handler.updates.map((update) => update.value)),
    ).toEqual([{ kind: "Primitive", value: "kept" }]);
  });
});
