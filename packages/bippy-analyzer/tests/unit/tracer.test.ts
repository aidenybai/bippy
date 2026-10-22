import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { createTracer } from "../../src/core/tracer";
import { getFixtureConfig } from "./helpers";

describe("tracing an analysis", () => {
  it("records a span per phase and component, with memory after each", () => {
    const tracer = createTracer();
    const project = analyzeProject(getFixtureConfig("conformance-repros"), "self-updates", tracer);
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
  });
});
