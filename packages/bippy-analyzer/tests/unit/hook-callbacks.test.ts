import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project.js";
import { formatSymbolicValue } from "../../src/core/format.js";
import { getBinding, getComponent, getFixtureConfig } from "./helpers.js";

describe("callbacks passed to hooks", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "hook-callbacks");
  const overlay = getComponent(project, "Overlay");

  it("runs a function passed to a hook it can't see into as an effect", () => {
    const [handler] = overlay.analysis.handlers;
    expect(handler?.trigger.kind).toBe("Effect");
    expect(
      handler?.updates.map((update) => [update.binding.name, formatSymbolicValue(update.value)]),
    ).toEqual([["mounted", "true"]]);
  });

  it("mounts a DOM node prop as unset, since no plain value stands in for one", () => {
    expect(getBinding(overlay, "container").samples).toEqual([
      { kind: "Value", value: null },
      { kind: "Undefined" },
    ]);
  });
});
