import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a first render that calls Math on known state", () => {
  const project = analyzeFixture("conformance-repros", "first-render-math");

  it.each([
    ["MaxStep", ["Math.max(step - 1, 0) === 0"]],
    ["HalfStep", ["Math.floor(step / 2) === 0"]],
  ])("%s starts from the computed value", (name, conditions) => {
    const { report } = getComponent(project, name);
    const firstState = report.regions[0]?.firstRenderState ?? null;
    expect(firstState === null ? null : report.states[firstState]?.conditions).toEqual(conditions);
  });
});
