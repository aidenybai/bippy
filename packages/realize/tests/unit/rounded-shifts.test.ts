import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import { analyzeFixture, getComponent } from "./helpers";

describe("shifting a strict bound by an offset that rounds", () => {
  const project = analyzeFixture("conformance-repros", "rounded-shifts");

  it.each([
    ["AddHuge", 9, "value >= 1e+308"],
    ["ScaleAndAdd", 21, "value >= 10000000000000000"],
  ])("lets %s reach the rounded value", (name, line, condition) => {
    const { analysis, report } = getComponent(project, name);
    const jumpId = analysis.handlers.find(
      (handler) => handler.loc !== GeneratedSource && handler.loc.start.line === line,
    )?.id;
    const lowState = report.states.find((state) => state.conditions.includes("value < 0.1"));
    const hugeIndex = report.states.findIndex((state) => state.conditions.includes(condition));
    expect(
      lowState?.transitions
        .filter((transition) => transition.handlerId === jumpId)
        .flatMap((transition) => transition.targets),
    ).toContain(hugeIndex);
  });
});
