import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a setter inside an array method callback", () => {
  const project = analyzeFixture("conformance-repros", "callback-setter-after-update");

  it.each(["SomeSetterAfterUpdate", "DerivedSetterAfterUpdate"])(
    "runs on the current array in %s, not only the first render's elements",
    (name) => {
      const { report } = getComponent(project, name);
      const high = report.states.findIndex((state) => state.conditions.includes("count > 3"));
      const low = report.states.findIndex((state) => state.conditions.includes("count <= 3"));
      const targets = report.states[high]?.transitions.flatMap((transition) => transition.targets);
      expect(targets).toContain(low);
    },
  );
});
