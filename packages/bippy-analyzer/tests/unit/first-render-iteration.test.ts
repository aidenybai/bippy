import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a first render that tests the items of literal state", () => {
  const project = analyzeFixture("conformance-repros", "first-render-iteration");

  it.each([
    ["AllDone", ["!tasks.every(function)"]],
    ["AnyDone", ["tasks.some(function)"]],
    ["SecondTask", ["tasks.find(function) !== undefined"]],
    ["DoneCount", ["tasks.filter(function).length === 1"]],
  ])("%s runs the callback over the initial items", (name, conditions) => {
    const { report } = getComponent(project, name);
    const firstState = report.regions[0]?.firstRenderState ?? null;
    expect(firstState === null ? null : report.states[firstState]?.conditions).toEqual(conditions);
  });
});
