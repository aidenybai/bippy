import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("computed keys", () => {
  const project = analyzeFixture("conformance-repros", "computed-keys");
  const getStateCount = (name: string): number => getComponent(project, name).report.states.length;

  it("lets an unknown computed key change any field", () => {
    expect(getStateCount("CategoryPicker")).toBe(2);
  });

  it("reads a computed key that is a known string", () => {
    expect(getStateCount("ConstantKeyPicker")).toBe(2);
  });
});
