import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("caught throws", () => {
  const project = analyzeFixture("conformance-repros", "caught-throws");

  const getRenders = (name: string) =>
    getComponent(project, name).report.states.map((state) => [
      state.conditions,
      state.fragments.map(formatSymbolicValue),
    ]);

  it("routes a throw inside a try to its catch", () => {
    expect(getRenders("ThrowCatch")).toEqual([
      [["Unknown(throws)"], ['"caught"']],
      [["!Unknown(throws)", "isOn"], ['"caught"']],
      [["!Unknown(throws)", "!isOn"], ['"fine"']],
    ]);
  });

  it("binds the thrown value to the catch parameter", () => {
    expect(getRenders("ThrownValue")).toEqual([
      [["Unknown(throws)"], ['"off"']],
      [["!Unknown(throws)", "isOn"], ['"on"']],
      [["!Unknown(throws)", "!isOn"], ['"off"']],
    ]);
  });

  it("keeps the guard of a throw in a handler's try", () => {
    const { analysis } = getComponent(project, "HandlerThrow");
    expect(
      analysis.handlers.flatMap((handler) =>
        handler.updates.map((update) => [
          formatSymbolicValue(update.value),
          update.guards.map(formatSymbolicValue),
        ]),
      ),
    ).toEqual([
      ['"failed"', ["!name"]],
      ['"saved"', ["name"]],
      ['"failed"', ["Unknown(throws)"]],
    ]);
  });
});
