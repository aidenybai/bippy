import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("reading a captured let or a ref after a branch wrote it", () => {
  const project = analyzeFixture("conformance-repros", "handler-cell-reads");

  const getFillTargets = (name: string) =>
    getComponent(project, name).report.states.map(
      (state) => state.transitions.find((transition) => transition.handlerId === "t1")?.targets,
    );

  it.each([
    ["CapturedOrAssign", [2, 2, 2]],
    ["CapturedIfAssign", [2, 2, 2]],
    ["ClosureBranchWrite", [0, 2, 1]],
    ["RefBranchWrite", [1, 2, 1]],
  ])("%s reaches the step the write leads to", (name, steps) => {
    const targets = getFillTargets(name);
    steps.forEach((step, index) => expect(targets[index]).toContain(step));
  });
});
