import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("handlers taken from an array that map built", () => {
  const project = analyzeFixture("conformance-repros", "mapped-handlers");

  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.value),
    );

  it("bind the callback's parameter to the element", () => {
    expect(getUpdates("MappedHandlers")).toEqual([
      { kind: "Primitive", value: "b" },
      { kind: "Primitive", value: "c" },
    ]);
  });

  it("also work when the element is called inside an arrow", () => {
    expect(getUpdates("CalledMappedHandler")).toEqual([{ kind: "Primitive", value: "c" }]);
  });

  it("reach every picked state", () => {
    const { report } = getComponent(project, "MappedHandlers");
    expect(report.states).toHaveLength(3);
    const first = report.regions[0]?.firstRenderState ?? -1;
    expect(report.states[first]?.transitions.map((transition) => transition.targets)).toEqual([
      [1],
      [2],
    ]);
  });
});
