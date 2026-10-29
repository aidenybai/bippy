import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an external store read through React or written by a store method", () => {
  const project = analyzeFixture("conformance-repros", "store-remainder");

  const getEdges = (name: string) => {
    const { states } = getComponent(project, name).report;
    return states.flatMap((state, index) =>
      state.transitions.flatMap((transition) =>
        transition.targets
          .filter((target) => target !== index)
          .map((target) => [
            state.conditions.join(" && "),
            states[target]?.conditions.join(" && "),
          ]),
      ),
    );
  };

  it.each(["StoreMethodHandler", "NamespaceStore", "DefaultImportStore"])(
    "%s may change the store's snapshot",
    (name) => {
      expect(getEdges(name)).toEqual([
        ["value === 1", "value !== 1"],
        ["value !== 1", "value === 1"],
      ]);
    },
  );
});
