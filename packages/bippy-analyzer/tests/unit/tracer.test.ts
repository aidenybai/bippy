import { dirname, isAbsolute } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { createTracer } from "../../src/core/tracer";
import { getFixtureConfig } from "./helpers";

describe("tracing an analysis", () => {
  it("records a span per phase and component, with memory after each", () => {
    const configPath = getFixtureConfig("conformance-repros");
    const tracer = createTracer(dirname(configPath));
    const project = analyzeProject(configPath, "self-updates", tracer);
    const spans = tracer.events.filter((event) => event.ph === "X");
    const categories = new Set(spans.map((event) => event.cat));
    expect([...categories]).toEqual(
      expect.arrayContaining(["typescript", "compile", "interpret", "link", "enumerate"]),
    );
    const enumerated = spans
      .filter((event) => event.cat === "enumerate")
      .map((event) => event.name);
    expect(enumerated).toEqual(
      expect.arrayContaining(project.components.map((component) => component.analysis.name)),
    );
    expect(tracer.events.filter((event) => event.ph === "C")).toHaveLength(spans.length);
    const compiled = spans.filter((event) => event.cat === "compile").map((event) => event.name);
    expect(compiled).toContain("src/self-updates.tsx");
    for (const event of spans) {
      expect(isAbsolute(event.name)).toBe(false);
      for (const value of Object.values(event.args))
        expect(typeof value === "string" && isAbsolute(value)).toBe(false);
    }
  });
});
