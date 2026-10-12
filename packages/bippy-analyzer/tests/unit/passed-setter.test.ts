import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project.js";
import { getComponent, getFixtureConfig } from "./helpers.js";

describe("setters passed to a child", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "passed-setter");
  const panel = getComponent(project, "SearchPanel");

  it("lets the child set the state to anything, under a prop name that isn't an event", () => {
    const [handler] = panel.analysis.handlers;
    expect(handler?.trigger).toEqual({ kind: "Event", tag: "Search", event: "setSearchTerm" });
    expect(handler?.updates.map((update) => [update.binding.name, update.value.kind])).toEqual([
      ["searchTerm", "Unknown"],
    ]);
  });

  it("reaches the state the child's input leads to", () => {
    expect(panel.report.states.map((state) => state.conditions)).toEqual([
      ['searchTerm === ""'],
      ['searchTerm !== ""'],
    ]);
  });

  it("runs the handlers in the JSX a render prop returns for the child to render", () => {
    const list = getComponent(project, "DeletableList");
    const [handler] = list.analysis.handlers;
    expect(handler?.trigger).toEqual({ kind: "Event", tag: "List", event: "renderAction" });
    expect(handler?.updates.map((update) => update.binding.name)).toEqual(["deletingId"]);
  });
});
