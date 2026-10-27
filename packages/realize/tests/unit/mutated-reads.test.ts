import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getBinding, getComponent } from "./helpers";

const getPlaceValues = (
  project: ReturnType<typeof analyzeFixture>,
  name: string,
  bindingName: string,
  path: string[],
) => {
  const component = getComponent(project, name);
  const { id } = getBinding(component, bindingName);
  return component.report.places.get({ bindingId: id, path });
};

describe("a read after state is mutated", () => {
  it("does not claim a length that a push during render changed", () => {
    const project = analyzeFixture("mutations");
    expect(getPlaceValues(project, "RenderMutation", "items", ["length"])).toBeUndefined();
  });

  it("does not claim a field that a helper bumped through a shallow copy during render", () => {
    const project = analyzeFixture("conformance-repros", "copied-helper-mutations");
    expect(getPlaceValues(project, "CopiedRowsInRender", "rows", ["0", "count"])).toBeUndefined();
  });

  it("does not bound a sliced copy by its source after a helper appends to it", () => {
    const project = analyzeFixture("conformance-repros", "copied-helper-mutations");
    expect(getPlaceValues(project, "AppendedCopyHelper", "rows", ["length"])).toBeUndefined();
  });
});
