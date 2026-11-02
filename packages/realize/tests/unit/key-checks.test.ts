import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("key checks on object literals", async () => {
  const project = await analyzeFixture("conformance-repros", "key-checks");

  it("decides whether each object literal passed in has the key", () => {
    const { analysis } = getComponent(project, "SizeForm");
    expect(
      analysis.handlers.map((handler) =>
        handler.updates.map((update) => [update.guards.length, formatSymbolicValue(update.value)]),
      ),
    ).toEqual([
      [[0, "{ width: size.width, height: size.height, radius: 2 }"]],
      [[0, "{ width: size.width, radius: size.radius, height: 6 }"]],
    ]);
  });

  it("decides a listed key, and leaves a key the prototype has undecided", () => {
    const { model } = getComponent(project, "EntryLabel");
    expect(model.branches.map((branch) => branch.label)).toEqual([
      '"toString" in { label: label }',
    ]);
  });
});
