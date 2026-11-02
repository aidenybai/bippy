import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a click that bubbles out of a nested render", async () => {
  const project = await analyzeFixture("conformance-repros", "nested-render-bubbling");

  const getUpdateSequences = (name: string) =>
    getComponent(project, name).analysis.handlers.map((handler) =>
      handler.updates.map((update) => update.binding.name),
    );

  it("runs an ancestor's handler after a button in an array a map returns", () => {
    expect(getUpdateSequences("ButtonInMappedPair")).toContainEqual(["isInner", "isOuter"]);
  });

  it("runs an ancestor's handler after a button a stale useMemo renders", () => {
    expect(getUpdateSequences("ButtonInStaleMemo")).toContainEqual(["isInner", "isOuter"]);
  });
});
