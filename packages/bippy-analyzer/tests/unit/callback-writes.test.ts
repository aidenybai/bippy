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
});
