import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("refs typed as null", () => {
  const project = analyzeFixture("conformance-repros", "attached-null-refs");

  const getCurrentValues = (name: string, label: string): string[] =>
    getComponent(project, name)
      .model.variables.find((variable) => variable.label === label)
      ?.domain.map((value) => value.label) ?? [];

  it("may hold a value once JSX receives the ref", () => {
    expect(getCurrentValues("FocusedField", "inputRef.current")).toEqual(["null", "attached"]);
    expect(getCurrentValues("ClosingPanel", "panelRef.current")).toEqual(["null", "attached"]);
  });

  it("stays null when no JSX receives the ref", () => {
    expect(getCurrentValues("DetachedPanel", "panelRef.current")).toEqual(["null"]);
  });
});
