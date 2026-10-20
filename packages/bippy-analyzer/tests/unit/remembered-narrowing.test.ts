import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("remembered narrowing", () => {
  const project = analyzeFixture("conformance-repros", "remembered-narrowing");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("keeps a string's truthiness once a test decides it", () => {
    expect(getConditions("ToolResult")).toEqual([["errorText"], ["!errorText"]]);
  });

  it("rules out other literals once a strict equality holds", () => {
    expect(getConditions("SignaturePad")).toEqual([
      ['tab === "draw"'],
      ['tab !== "draw"', 'tab === "type"'],
      ['tab !== "draw"', 'tab !== "type"', 'tab === "upload"'],
      ['tab !== "draw"', 'tab !== "type"', 'tab !== "upload"'],
    ]);
  });

  it("decides a strict equality from a remembered inequality", () => {
    expect(getConditions("LayoutBadge")).toEqual([
      ['layout !== "legacy"'],
      ['layout === "legacy"'],
      ["isOpen"],
      ["!isOpen"],
    ]);
  });
});
