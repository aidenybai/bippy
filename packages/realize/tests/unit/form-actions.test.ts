import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("form actions", () => {
  const project = analyzeFixture("symbolic-tree", "form-actions.tsx");

  it("runs a function passed as a form's action on submit", () => {
    const { analysis, report } = getComponent(project, "SaveForm");
    const [handler] = analysis.handlers;
    expect(analysis.handlers).toHaveLength(1);
    expect(handler?.trigger).toEqual({ kind: "Event", tag: "form", event: "submit" });
    expect(handler?.updates.map((update) => [update.binding.name, update.isAsync])).toEqual([
      ["loading", false],
      ["loading", true],
      ["loading", true],
    ]);
    expect(report.states).toHaveLength(2);
    expect(report.states.flatMap((state) => state.transitions)).not.toHaveLength(0);
    expect(report.unreachableBranches).toHaveLength(0);
  });

  it("runs useActionState's action like a reducer on its form's submit", () => {
    const { analysis, report } = getComponent(project, "NameForm");
    const [handler] = analysis.handlers;
    expect(handler?.trigger).toEqual({ kind: "Event", tag: "form", event: "submit" });
    expect(handler?.updates.map((update) => update.binding.name)).toEqual(["name"]);
    expect(analysis.bindings.map((binding) => [binding.name, binding.kind])).toEqual([
      ["name", "reducer"],
      ["isPending", "hook"],
    ]);
    expect(report.states.length).toBeGreaterThanOrEqual(2);
  });
});
