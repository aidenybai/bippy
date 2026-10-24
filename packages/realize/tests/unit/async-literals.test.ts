import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("literal updates after an await", () => {
  const project = analyzeFixture("conformance-repros", "async-literals");

  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => [update.binding.name, update.isAsync, update.value.kind]),
    );

  it("keeps an object or array literal that reads no binding", () => {
    expect(getUpdates("AsyncObject")).toEqual([
      ["position", true, "ObjectExpression"],
      ["items", true, "ArrayExpression"],
      ["label", true, "Primitive"],
    ]);
  });

  it("still forgets a value that reads state captured before the await", () => {
    expect(getUpdates("AsyncAppend")).toEqual([["items", true, "Unknown"]]);
  });
});
