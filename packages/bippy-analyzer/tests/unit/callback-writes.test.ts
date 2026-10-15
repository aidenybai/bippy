import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { forEachRenderNode } from "../../src/core/utils/traverse";
import { getTestExpression } from "../../src/core/utils/truthiness";
import { analyzeFixture, getComponent } from "./helpers";

describe("callback writes", () => {
  it("forgets a local an opaque call's callback may reassign", () => {
    const project = analyzeFixture("conformance-repros", "callback-writes");
    const tests: string[] = [];
    forEachRenderNode(getComponent(project, "DiffStats").analysis.render, (node) => {
      if (node.kind === "Conditional") tests.push(formatSymbolicValue(getTestExpression(node)));
    });
    expect(tests).not.toContain("0 > 0");
  });

  it("forgets an array an opaque call's callback pushes into", () => {
    const project = analyzeFixture("conformance-repros", "children-iteration");
    const tags = getComponent(project, "SectionList").report.states.map((state) =>
      state.render.kind === "JsxExpression" && state.render.tag.kind === "BuiltinTag"
        ? state.render.tag.name
        : null,
    );
    expect(tags).toEqual(expect.arrayContaining(["p", "div"]));
  });
});
