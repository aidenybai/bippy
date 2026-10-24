import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getBinding, getComponent } from "./helpers";

describe("type samples", () => {
  it("samples a ComponentType field as something React can render", () => {
    const project = analyzeFixture("conformance-repros", "component-type-prop");
    const projectSample = getBinding(getComponent(project, "ProjectLabel"), "project").samples[0];
    expect(projectSample).toMatchObject({ kind: "Object", fields: { icon: { kind: "Function" } } });
  });

  it("ends a recursive optional field instead of leaving an endless open object", () => {
    const folderPath = getComponent(
      analyzeFixture("conformance-repros", "recursive-parent"),
      "FolderPath",
    );
    let folderSample = getBinding(folderPath, "folder").samples[0];
    let depth = 0;
    while (folderSample?.kind === "Object" && folderSample.fields.parent) {
      folderSample = folderSample.fields.parent;
      depth++;
    }
    expect(folderSample).toMatchObject({ kind: "Object", isOpen: false });
    expect(depth).toBeLessThan(5);
  });

  it("samples a branded string or map as the value it brands", () => {
    const shapeSummary = getComponent(
      analyzeFixture("conformance-repros", "branded-props"),
      "ShapeSummary",
    );
    expect(getBinding(shapeSummary, "ownerId").samples[0]).toMatchObject({ kind: "Value" });
    expect(getBinding(shapeSummary, "shapes").samples[0]).toMatchObject({ kind: "Map" });
  });
});
