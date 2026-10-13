import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/core/analyze-project.js";
import { getComponent, getFixtureConfig } from "./helpers.js";

describe("pure built-in methods", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "non-mutating-methods");
  const picker = getComponent(project, "ItemPicker");
  const [pick, refresh] = picker.analysis.handlers;

  it("doesn't change a context whose array and string a handler only reads", () => {
    expect(pick?.updates.map((update) => update.binding.name)).toEqual(["selected"]);
  });

  it("still changes a context whose function a handler calls", () => {
    expect(refresh?.updates.map((update) => update.binding.name)).toEqual(["list"]);
  });
});
