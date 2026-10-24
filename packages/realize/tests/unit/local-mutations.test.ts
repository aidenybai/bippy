import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { forEachSymbolicValue } from "../../src/core/utils/for-each-symbolic-value";
import { analyzeFixture, getComponent } from "./helpers";

describe("local mutations", () => {
  const project = analyzeFixture("symbolic-tree", "local-mutations");
  const component = getComponent(project, "TagEditor");

  it("sets state to a copy with the pushed item, so adding leaves the empty state", () => {
    const [empty] = component.report.states;
    expect(empty?.conditions).toEqual(["tags.length === 0"]);
    expect(empty?.transitions.map((transition) => transition.targets)).toEqual([[1]]);
    const [handler] = component.analysis.handlers;
    expect(handler?.updates.map((update) => formatSymbolicValue(update.value))).toEqual([
      '[...tags, "tag"]',
    ]);
  });

  it("renders what render pushes into a local array", () => {
    const tags: string[] = [];
    forEachSymbolicValue(component.analysis.render, (value) => {
      if (value.kind === "JsxExpression") tags.push(value.tag.name);
    });
    expect(tags).toContain("h2");
  });
});
