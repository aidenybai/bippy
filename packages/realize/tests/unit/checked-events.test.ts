import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("a change on a controlled checkbox or radio", () => {
  const project = analyzeFixture("conformance-repros", "checked-events");

  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.value),
    );

  it("reads the flipped checked value from a checkbox", () => {
    expect(getUpdates("ControlledCheckbox")).toMatchObject([
      { kind: "UnaryExpression", operator: "!" },
    ]);
    expect(getUpdates("FixedCheckbox")).toEqual([{ kind: "Primitive", value: "a" }]);
  });

  it("reads the value attribute of the input", () => {
    expect(getUpdates("RadioValue")).toEqual([{ kind: "Primitive", value: "a" }]);
  });

  it("reads one of the option values from a select", () => {
    const { report } = getComponent(project, "SelectValue");
    expect(report.states.map((state) => state.conditions)).toEqual([[]]);
  });

  it("never fires a radio that is always checked", () => {
    const { states } = getComponent(project, "CheckedRadio").report;
    const changes = states.flatMap((state, index) =>
      state.transitions.flatMap((transition) =>
        transition.targets.filter((target) => target !== index),
      ),
    );
    expect(changes).toEqual([]);
  });

  it("reads checked as true from a radio", () => {
    expect(getUpdates("UncheckedRadio")).toEqual([{ kind: "Primitive", value: "a" }]);
  });
  it("fires a click on a radio that is already checked", () => {
    const { states } = getComponent(project, "ClickedRadio").report;
    const fresh = states.findIndex((state) => state.conditions.includes("count <= 0"));
    const clicked = states.findIndex((state) => state.conditions.includes("count > 0"));
    const targets = states[fresh]?.transitions.flatMap((transition) => transition.targets);
    expect(targets).toContain(clicked);
  });
  it("runs the click handlers and then the change handlers in one click", () => {
    const sequences = getComponent(project, "ClickThenChange").analysis.handlers.map((handler) =>
      handler.updates.map(
        (update) => `${update.binding.name} = ${formatSymbolicValue(update.value)}`,
      ),
    );
    expect(sequences).toContainEqual(["isClicked = true", "isOn = !isOn"]);
  });
});
