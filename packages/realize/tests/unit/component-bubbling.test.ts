import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a click that bubbles across a component boundary", () => {
  const project = analyzeFixture("conformance-repros", "component-bubbling");

  const getUpdateSequences = (name: string) =>
    getComponent(project, name).analysis.handlers.map((handler) =>
      handler.updates.map((update) => update.binding.name),
    );

  it("runs an ancestor's handler after a child's callback prop", () => {
    expect(getUpdateSequences("ChildButtonInDiv")).toContainEqual(["isInner", "isOuter"]);
  });

  it("runs a child wrapper's callback prop after a button passed as children", () => {
    expect(getUpdateSequences("ButtonInChildPanel")).toContainEqual(["isInner", "isOuter"]);
  });
  it("runs an ancestor's handler after a context callback a consumer calls", () => {
    expect(getUpdateSequences("ConsumerInDiv")).toContainEqual(["isInner", "isOuter"]);
  });
});
