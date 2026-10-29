import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a handler read from a table built in render", () => {
  const project = analyzeFixture("conformance-repros", "handler-tables");

  it.each([
    "ComputedTable",
    "SpreadThenComputed",
    "SpreadArrayTable",
    "MapWrites",
    "ReducedTable",
    "FilteredTable",
  ])("lets %s run the entry that sets 2", (name) => {
    const { states } = getComponent(project, name).report;
    const twoIndex = states.findIndex((state) => state.conditions.includes("n === 2"));
    expect(
      states.some((state) =>
        state.transitions.some((transition) => transition.targets.includes(twoIndex)),
      ),
    ).toBe(true);
  });
});
