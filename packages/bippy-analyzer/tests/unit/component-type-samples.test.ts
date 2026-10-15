import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getBinding, getComponent } from "./helpers";

describe("component type samples", () => {
  it("samples a ComponentType field as something React can render", () => {
    const project = analyzeFixture("conformance-repros", "component-type-prop");
    const projectSample = getBinding(getComponent(project, "ProjectLabel"), "project").samples[0];
    expect(projectSample).toMatchObject({ kind: "Object", fields: { icon: { kind: "Function" } } });
  });
});
