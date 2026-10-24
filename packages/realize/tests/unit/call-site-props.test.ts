import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture } from "./helpers";

describe("untyped props from call sites", () => {
  const project = analyzeFixture("plain-jsx", "badges");
  const getTone = (file: string) =>
    project.components
      .find(
        (component) =>
          component.analysis.file.endsWith(file) && component.analysis.name === "Badge",
      )
      ?.analysis.bindings.find((binding) => binding.name === "tone")?.domain;

  it("narrow the component the call site renders", () => {
    expect(getTone("badges/badge.jsx")).toMatchObject({ kind: "Cases", origin: "call-sites" });
  });

  it("leave a same-named component in another file alone", () => {
    expect(getTone("badges/other-badge.jsx")).toMatchObject({ kind: "Unknown" });
  });
});
