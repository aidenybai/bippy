import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("this in an object method", () => {
  const project = analyzeFixture("conformance-repros", "this-methods");

  it.each(["LocalThis", "FactoryThis", "ArrowThis", "BorrowedThis"])(
    "lets %s reach the receiver's step",
    (name) => {
      const { states } = getComponent(project, name).report;
      const twoIndex = states.findIndex((state) => state.conditions.includes("n === 2"));
      expect(
        states.some((state) =>
          state.transitions.some((transition) => transition.targets.includes(twoIndex)),
        ),
      ).toBe(true);
    },
  );
});
