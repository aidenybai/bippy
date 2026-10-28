import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import { analyzeFixture, getComponent } from "./helpers";

describe("adding one to state that may hold text", () => {
  const project = analyzeFixture("conformance-repros", "number-text-states");

  it.each([
    ["PlusOneAfterText", 8],
    ["AnyPlusOne", 19],
  ])("lets %s concatenate past the bound", (name, line) => {
    const { analysis, report } = getComponent(project, name);
    const incrementId = analysis.handlers.find(
      (handler) => handler.loc !== GeneratedSource && handler.loc.start.line === line,
    )?.id;
    const smallState = report.states.find((state) => state.conditions.includes("!(value > 5)"));
    const bigIndex = report.states.findIndex((state) => state.conditions.includes("value > 5"));
    expect(
      smallState?.transitions
        .filter((transition) => transition.handlerId === incrementId)
        .flatMap((transition) => transition.targets),
    ).toContain(bigIndex);
  });
});
