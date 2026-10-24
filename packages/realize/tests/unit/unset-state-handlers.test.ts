import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a function kept in a state that has no setter", () => {
  const project = analyzeFixture("conformance-repros", "unset-state-handlers");

  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.value),
    );

  it("is the handler it holds", () => {
    expect(getUpdates("StateHandler")).toEqual([{ kind: "Primitive", value: true }]);
    expect(
      getComponent(project, "StateHandler").analysis.bindings.map((binding) => binding.name),
    ).toEqual(["isDone"]);
  });

  it("is called with the handler's arguments", () => {
    expect(getUpdates("CalledStateHandler")).toEqual([{ kind: "Primitive", value: "b" }]);
  });
});
