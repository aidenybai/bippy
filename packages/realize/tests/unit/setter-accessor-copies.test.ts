import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("an object literal with a setter accessor", async () => {
  const project = await analyzeFixture("conformance-repros", "setter-accessor-copies");
  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => formatSymbolicValue(update.value)),
    );

  it("leaves the setter out of a spread copy", () => {
    expect(getUpdates("CopiedSetterSink")).toEqual([]);
  });

  it("leaves the setter out of Object.keys", () => {
    expect(getUpdates("SetterStateKeys").join()).not.toContain("set:");
  });
});
