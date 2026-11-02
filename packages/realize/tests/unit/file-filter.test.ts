import { dirname } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/project/analyze-project";
import { createTracer } from "../../src/core/project/tracer";
import { getFixtureConfig } from "./helpers";

describe("a file filter", () => {
  it("only models the components in the selected files", async () => {
    const configPath = getFixtureConfig("conformance-repros");
    const tracer = createTracer(dirname(configPath));
    const project = await analyzeProject(configPath, "self-updates", tracer);
    const modeled = tracer.events
      .filter((event) => event.ph === "X" && event.cat === "model")
      .map((event) => event.name);
    expect(new Set(modeled)).toEqual(
      new Set(project.components.map((component) => component.analysis.name)),
    );
  });
});
