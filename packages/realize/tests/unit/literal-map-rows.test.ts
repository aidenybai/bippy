import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a map over a literal array", () => {
  const project = analyzeFixture("conformance-repros", "literal-map-rows");

  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.value),
    );

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("binds the callback's parameter to each element", () => {
    expect(getUpdates("MappedHandlers")).toEqual([
      { kind: "Primitive", value: "b" },
      { kind: "Primitive", value: "c" },
    ]);
    expect(getTargets("MappedHandlers")).toEqual([
      [[1], [2]],
      [[1], [2]],
      [[1], [2]],
    ]);
  });

  it("resolves an element that a handler calls", () => {
    expect(getUpdates("CalledMappedHandler")).toEqual([{ kind: "Primitive", value: "c" }]);
  });

  it("gives each row its own call results", () => {
    const { analysis, report } = getComponent(project, "CheckedRows");
    expect(analysis.bindings.filter((binding) => binding.kind === "call")).toHaveLength(2);
    expect(report.states).toHaveLength(4);
  });

  it("collects the handlers of each rendered row", () => {
    expect(getUpdates("ActionRows")).toEqual([{ kind: "Primitive", value: true }]);
    expect(getUpdates("PassedRows")).toEqual([
      { kind: "Primitive", value: "b" },
      { kind: "Primitive", value: "c" },
    ]);
  });
});
