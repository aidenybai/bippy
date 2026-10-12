import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/core/analyze-project.js";
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

  it("samples an untyped context by what the component reads from it", () => {
    const { contextSamples } = getComponent(project, "UserName").analysis;
    expect([...contextSamples.values()]).toEqual([
      {
        kind: "Object",
        fields: {
          profile: {
            kind: "Object",
            fields: { name: { kind: "Value", value: "text" } },
            isOpen: false,
          },
        },
        isOpen: false,
      },
    ]);
  });

  it("treats a tag held in a prop as any element type", () => {
    const { render } = getComponent(project, "ConfirmButton").analysis;
    const tags = render.kind === "Conditional" ? [render.consequent, render.alternate] : [render];
    expect(tags.map((tag) => tag.kind === "JsxExpression" && tag.tag.kind)).toEqual([
      "DynamicTag",
      "Component",
    ]);
  });
});
