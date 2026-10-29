import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a setter kept in a literal collection", () => {
  const project = analyzeFixture("conformance-repros", "setters-in-collections");
  const getTargets = (name: string, condition: string) => {
    const { states } = getComponent(project, name).report;
    const state = states.find((candidate) => candidate.conditions.includes(condition));
    return state?.transitions.flatMap((transition) =>
      transition.targets.map((target) => states[target]?.conditions),
    );
  };

  it("is called when read from a Map with get", () => {
    expect(getTargets("SetterInMap", "!isOn")).toContainEqual(["isOn"]);
    expect(getTargets("SetterFromMapGet", "!isOn")).toContainEqual(["isOn"]);
  });

  it("is called when a Set's forEach passes it", () => {
    expect(getTargets("SetterInSet", "!isOn")).toContainEqual(["isOn"]);
  });
});
