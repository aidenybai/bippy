import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("++ on a local that a closure captures, inside a handler", () => {
  const project = analyzeFixture("conformance-repros", "context-updates");

  it.each([
    ["CapturedIncrement", 2],
    ["IncrementAfterClosure", 1],
  ])("%s sets %s", (name, value) => {
    const values = getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.value),
    );
    expect(values).toEqual([{ kind: "Primitive", value }]);
  });
});
