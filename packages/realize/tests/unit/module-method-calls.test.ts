import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a method call on a module value built by a call", () => {
  const project = analyzeFixture("conformance-repros", "module-method-calls");

  it.each([
    ["ClosureSwitch", "lamp.on"],
    ["AnonymousClassSwitch", "fan.on"],
  ])("lets a click in %s change %s", (name, condition) => {
    const { states } = getComponent(project, name).report;
    const onIndex = states.findIndex((state) => state.conditions.includes(condition));
    const off = states.find((state) => state.conditions.includes(`!${condition}`));
    expect(off?.transitions.some((transition) => transition.targets.includes(onIndex))).toBe(true);
  });
});
