import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("handlers in arrays", () => {
  it("collects callbacks a component prop passes inside an array", () => {
    const project = analyzeFixture("conformance-repros", "handlers-in-arrays");
    const updatedNames = getComponent(project, "ProfileForm").analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.binding.name),
    );
    expect(updatedNames).toContain("name");
  });
});
