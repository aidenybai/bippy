import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a module object written through this", () => {
  const project = analyzeFixture("conformance-repros", "module-this-writes");

  it.each([
    ["ToggledFlag", "flags.open"],
    ["NestedFlag", "settings.view.open"],
    ["ClassFlag", "panel.open"],
  ])("lets a click in %s set %s", (name, condition) => {
    const { states } = getComponent(project, name).report;
    const openIndex = states.findIndex((state) => state.conditions.includes(condition));
    const closed = states.find((state) => state.conditions.includes(`!${condition}`));
    expect(closed?.transitions.some((transition) => transition.targets.includes(openIndex))).toBe(
      true,
    );
  });
});
