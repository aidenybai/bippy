import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project.js";
import { getComponent, getFixtureConfig } from "./helpers.js";

describe("context tags", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "context-tag");

  it("marks a context rendered as its own provider, as React 19 allows", () => {
    const { render } = getComponent(project, "FontProvider").analysis;
    expect(render.kind === "JsxExpression" && render.tag).toMatchObject({
      kind: "Component",
      name: "FontContext",
      isContext: true,
    });
  });
});
