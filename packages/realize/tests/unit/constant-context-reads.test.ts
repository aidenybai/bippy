import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a const read from an async callback", () => {
  const project = analyzeFixture("conformance-repros", "constant-context-reads");

  const getUpdatedNames = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.binding.name),
    );

  it("calls a function declared after the effect", () => {
    expect(getUpdatedNames("DeclaredLater")).toEqual(["items"]);
    expect(getComponent(project, "DeclaredLater").report.states).toHaveLength(2);
  });

  it("calls a helper that calls itself", () => {
    expect(getUpdatedNames("RecursiveRetry")).toContain("status");
    expect(getComponent(project, "RecursiveRetry").report.states).toHaveLength(2);
  });

  it("calls a function declared later after an await", () => {
    expect(getUpdatedNames("CloseAfterAwait")).toEqual(["isOpen"]);
    expect(getComponent(project, "CloseAfterAwait").report.states).toHaveLength(2);
  });
});
