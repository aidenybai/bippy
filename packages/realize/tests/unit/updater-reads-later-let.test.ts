import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an updater that reads a let the handler reassigns", () => {
  const project = analyzeFixture("conformance-repros", "updater-reads-later-let");
  const getTargets = (name: string, condition: string) => {
    const { states } = getComponent(project, name).report;
    const state = states.find((candidate) => candidate.conditions.includes(condition));
    return state?.transitions.flatMap((transition) =>
      transition.targets.map((target) => states[target]?.conditions),
    );
  };

  it("may run after the reassignment when React queues it", () => {
    expect(getTargets("UpdaterReadsLocalLet", "isOn")).toContainEqual(["!isOn"]);
    expect(getTargets("UpdaterReadsComponentLet", "isOn")).toContainEqual(["!isOn"]);
  });
});
