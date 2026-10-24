import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a memoized object a handler mutates", () => {
  const project = analyzeFixture("conformance-repros", "memo-object-mutations");

  for (const name of ["MemoCounter", "MemoCounterWithRender"]) {
    const { analysis, report } = getComponent(project, name);
    const findState = (condition: string) =>
      report.states.findIndex((state) => state.conditions.includes(condition));

    it(`${name} keeps the memoized object as a binding`, () => {
      expect(analysis.bindings.find((binding) => binding.name === "box")?.kind).toBe("memo");
      expect(analysis.warnings.map((warning) => warning.kind)).toContain("state-mutation");
    });

    it(`${name} shows the mutated field only after a render`, () => {
      const before = findState("!(box.clicks > 0)");
      const after = findState("box.clicks > 0");
      if (name === "MemoCounter") {
        expect(report.states.map((state) => state.conditions)).toEqual([[]]);
        return;
      }
      expect(before).not.toBe(-1);
      const clicked = report.states[before]?.transitions.flatMap(
        (transition) => transition.targets,
      );
      expect(clicked).toContain(after);
    });
  }

  for (const name of ["MemoReflectSet", "MemoObjectAssign"]) {
    const { analysis, report } = getComponent(project, name);

    it(`${name} keeps an object an opaque call may mutate as a binding`, () => {
      expect(analysis.bindings.find((binding) => binding.name === "box")?.kind).toBe("memo");
      expect(report.states.flatMap((state) => state.conditions)).toContain("box.clicks > 0");
    });
  }
});
