import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("context writes in loops", () => {
  const project = analyzeFixture("conformance-repros", "loop-context-writes");

  const getReport = (name: string) => {
    const { analysis, report } = getComponent(project, name);
    return {
      updates: analysis.handlers.flatMap((handler) =>
        handler.updates.map((update) => [update.binding.name, update.value.kind]),
      ),
      stateCount: report.states.length,
    };
  };

  it("reads a shared variable a loop body updates as a loop value", () => {
    expect(getReport("LoopPushedHandler")).toEqual({
      updates: [["slot", "Unknown"]],
      stateCount: 3,
    });
  });

  it("reads a shared variable a loop body stores as a loop value", () => {
    expect(getReport("LetAfterLoop")).toEqual({ updates: [["slot", "Unknown"]], stateCount: 2 });
  });

  it("collects a handler pushed in a loop over a var", () => {
    expect(getReport("VarLoopHandler")).toEqual({
      updates: [["slot", "Unknown"]],
      stateCount: 3,
    });
  });
});
