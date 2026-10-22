import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent, getWarningKinds } from "./helpers";

describe("a ref prop written through a helper", () => {
  const project = analyzeFixture("conformance-repros", "ref-prop-helpers");

  it("is not a prop mutation", () => {
    expect(getWarningKinds(getComponent(project, "ForwardedBox"))).toEqual([]);
  });

  it("still warns for a prop that is not a ref", () => {
    expect(getWarningKinds(getComponent(project, "ConfigEditor"))).toEqual(["prop-mutation"]);
  });
});
