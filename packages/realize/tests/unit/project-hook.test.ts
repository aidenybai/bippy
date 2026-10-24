import { describe, expect, it } from "vite-plus/test";
import { forEachRenderNode } from "../../src/core/utils/for-each-render-node";
import { analyzeFixture, getComponent } from "./helpers";

describe("project hooks", () => {
  const project = analyzeFixture("conformance-repros", "project-hook");
  const disclosure = getComponent(project, "Disclosure");

  it("runs a project hook from another file as part of the component", () => {
    expect(disclosure.analysis.bindings.map((binding) => [binding.name, binding.kind])).toEqual([
      ["isOn", "state"],
    ]);
  });

  it("follows the functions a project hook returns to the state they set", () => {
    const [toggle] = disclosure.analysis.handlers;
    expect(toggle?.updates.map((update) => update.binding.name)).toEqual(["isOn"]);
    expect(disclosure.report.states).toHaveLength(2);
  });

  it("puts a branch of the hook's file in that file", () => {
    const files = new Set<string>();
    forEachRenderNode(disclosure.analysis.render, (value) => {
      if (value.kind === "Conditional") files.add(value.branch.file.split("/").pop() ?? "");
    });
    expect([...files].sort()).toEqual(["project-hook.tsx", "use-toggle.ts"]);
  });
});
