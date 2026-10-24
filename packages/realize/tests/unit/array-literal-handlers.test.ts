import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("handlers in array literals", () => {
  const project = analyzeFixture("conformance-repros", "array-literal-handlers");

  const getReport = (name: string) => {
    const { analysis, report } = getComponent(project, name);
    return {
      updates: analysis.handlers.flatMap((handler) =>
        handler.updates.map((update) => update.binding.name),
      ),
      conditions: report.states.map((state) => state.conditions),
    };
  };

  it("collects a handler on an element inside an array literal child", () => {
    expect(getReport("JsxInArrayLiteral")).toEqual({
      updates: ["isDone"],
      conditions: [["isDone"], ["!isDone"]],
    });
  });

  it("reads a handler by index from an array literal", () => {
    expect(getReport("HandlerFromLiteralArray")).toEqual({
      updates: ["isDone"],
      conditions: [["isDone"], ["!isDone"]],
    });
  });

  it("reads undefined past the end of an array literal", () => {
    expect(getReport("MissingIndex")).toEqual({ updates: [], conditions: [[]] });
  });
});
