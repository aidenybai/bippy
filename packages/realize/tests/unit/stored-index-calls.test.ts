import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a stored function called by index", () => {
  const project = analyzeFixture("conformance-repros", "stored-index-calls");

  it.each(["PushedTableIndex", "ValuesIndex"])(
    "reaches the indexed function's update in %s",
    (name) => {
      const { states } = getComponent(project, name).report;
      const other = states.findIndex((state) => state.conditions.includes("n !== 2"));
      const two = states.findIndex((state) => state.conditions.includes("n === 2"));
      const targets = states[other]?.transitions.flatMap((transition) => transition.targets);
      expect(targets).toContain(two);
    },
  );
});
