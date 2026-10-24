import { dirname } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { createTracer } from "../../src/core/tracer";
import { getFixtureConfig } from "./helpers";

describe("a file filter", () => {
  it("only enumerates the components in the selected files", () => {
    const configPath = getFixtureConfig("conformance-repros");
    const tracer = createTracer(dirname(configPath));
    const project = analyzeProject(configPath, "self-updates", tracer);
    const enumerated = tracer.events
      .filter((event) => event.ph === "X" && event.cat === "enumerate")
      .map((event) => event.name);
    expect(new Set(enumerated)).toEqual(
      new Set(project.components.map((component) => component.analysis.name)),
    );
  });
});
