import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("updaters queued in a loop", () => {
  const project = analyzeFixture("conformance-repros", "loop-updaters");
  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("apply once per iteration after a plain set", () => {
    expect(getConditions("SetThenLoopUpdaters")).toContainEqual(["n === 3"]);
  });

  it("apply once per iteration on their own", () => {
    expect(getConditions("LoopUpdatersOnly")).toContainEqual(["n === 2"]);
  });
});
