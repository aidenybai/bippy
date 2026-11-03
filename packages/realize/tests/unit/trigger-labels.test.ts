import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("trigger labels", async () => {
  const project = await analyzeFixture("conformance-repros");
  const getLabels = (name: string): string[] => [
    ...new Set(
      getComponent(project, name)
        .model.actions.filter((action) => action.handlerId !== null)
        .map((action) => action.label),
    ),
  ];

  it("names a function declaration handler", () => {
    expect(getLabels("ThemeCycler")).toEqual(["nextTheme"]);
  });

  it("names a handler wrapped in useCallback after its variable", () => {
    expect(getLabels("ListedHelperCallback")).toEqual(["next"]);
  });

  it("names a lowered class method", () => {
    expect(getLabels("ClassSwitch")).toEqual(["flip"]);
  });

  it("keeps the body of an inline handler", () => {
    expect(getLabels("CompiledToggle")).toEqual(["setOn(!on)"]);
  });
});
