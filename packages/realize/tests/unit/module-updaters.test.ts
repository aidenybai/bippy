import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("a module-level function used as an updater or initializer", () => {
  const project = analyzeFixture("conformance-repros", "module-updaters");

  const getFirstRenderConditions = (name: string) => {
    const { report } = getComponent(project, name);
    const firstState = report.regions[0]?.firstRenderState ?? null;
    return firstState === null ? null : report.states[firstState]?.conditions;
  };

  it("runs as a setter's updater", () => {
    const updates = getComponent(project, "NamedUpdater").analysis.handlers.flatMap(
      (handler) => handler.updates,
    );
    expect(updates.map((update) => formatSymbolicValue(update.value))).toEqual(["count + 1"]);
  });

  it("runs as useState's lazy initializer", () => {
    expect(getFirstRenderConditions("NamedInitializer")).toEqual(["count === 1"]);
  });

  it("runs as useReducer's init", () => {
    expect(getFirstRenderConditions("NamedReducerInit")).toEqual(["count === 0"]);
  });
});
