import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a function kept in a ref that nothing writes", () => {
  const project = analyzeFixture("conformance-repros", "constant-ref-handlers");

  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.value),
    );

  const getRefBindings = (name: string) =>
    getComponent(project, name)
      .analysis.bindings.filter((binding) => binding.kind === "ref")
      .map((binding) => binding.name);

  it("is the handler it holds", () => {
    expect(getUpdates("RefHandler")).toEqual([{ kind: "Primitive", value: true }]);
    expect(getRefBindings("RefHandler")).toEqual([]);
  });

  it("is called with the handler's arguments", () => {
    expect(getUpdates("CalledRefHandler")).toEqual([{ kind: "Primitive", value: "b" }]);
  });

  it("keeps its ref binding when a handler writes it", () => {
    expect(getRefBindings("WrittenRefHandler")).toEqual(["go"]);
  });
});
