import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("pure built-in methods", () => {
  const project = analyzeFixture("conformance-repros", "non-mutating-methods");
  const picker = getComponent(project, "ItemPicker");
  const [pick, refresh, pickPinned] = picker.analysis.handlers;

  it("doesn't change a context whose array and string a handler only reads", () => {
    expect(pick?.updates.map((update) => update.binding.name)).toEqual(["selected"]);
  });

  it("doesn't change a context whose set and map a handler only looks up", () => {
    expect(pickPinned?.updates.map((update) => update.binding.name)).toEqual(["selected"]);
  });

  it("still changes a context whose function a handler calls", () => {
    expect(refresh?.updates.map((update) => update.binding.name)).toEqual(["list"]);
  });
});
