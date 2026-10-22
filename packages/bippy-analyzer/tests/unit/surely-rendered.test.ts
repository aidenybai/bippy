import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a mutation next to a set that may keep the same value", () => {
  const project = analyzeFixture("conformance-repros", "surely-rendered");

  it("shows on the next render from another handler", () => {
    const component = getComponent(project, "PushSameValue");
    const flip = component.analysis.handlers.find((handler) =>
      handler.updates.some((update) => update.binding.name === "isOn"),
    );
    expect(flip?.updates.map((update) => update.binding.name)).toContain("items");
  });
});
