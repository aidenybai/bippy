import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("callbacks bound with Function.prototype.bind", () => {
  const project = analyzeFixture("conformance-repros", "bound-callbacks");

  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => [update.binding.name, update.value]),
    );

  it("a bound setter sets the bound value", () => {
    expect(getUpdates("BoundSetter")).toEqual([["flag", { kind: "Primitive", value: true }]]);
  });

  it("a bound handler receives the bound argument", () => {
    expect(getUpdates("BoundHandler")).toEqual([["mode", { kind: "Primitive", value: "b" }]]);
  });

  it("the bound state is reachable", () => {
    const { report } = getComponent(project, "BoundSetter");
    const before = report.states.findIndex((state) => state.conditions.includes("!flag"));
    const after = report.states.findIndex((state) => state.conditions.includes("flag"));
    expect(report.states[before]?.transitions.flatMap((transition) => transition.targets)).toEqual([
      after,
    ]);
  });
});
