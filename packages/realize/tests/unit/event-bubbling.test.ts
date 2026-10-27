import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("a click that bubbles to an ancestor's handler", () => {
  const project = analyzeFixture("conformance-repros", "event-bubbling");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  const getUpdateSequences = (name: string) =>
    getComponent(project, name).analysis.handlers.map((handler) =>
      handler.updates.map(
        (update) => `${update.binding.name} = ${formatSymbolicValue(update.value)}`,
      ),
    );

  it("runs the target's handler and then the ancestor's as one transition", () => {
    expect(getUpdateSequences("Bubbling")).toEqual([
      ["outer = true"],
      ["inner = true", "outer = true"],
    ]);
    expect(getTargets("Bubbling")).toEqual([
      [[0], [0]],
      [[0], [0]],
      [[2], [0]],
      [[2], [0]],
    ]);
  });

  it("stops at a handler that calls stopPropagation", () => {
    expect(getUpdateSequences("Stopped")).toEqual([["outer = true"], ["inner = true"]]);
    expect(getTargets("Stopped")[3]).toEqual([[2], [1]]);
  });

  it("stops at an ancestor's handler that calls stopPropagation", () => {
    expect(getUpdateSequences("StoppedByAncestor")).toEqual([
      ["isOn = true"],
      ["count = 2"],
      ["isOn = false", "count = 2"],
    ]);
  });

  it("submits the form after a submit button's click unless the click prevents it", () => {
    expect(getUpdateSequences("SubmitButton")).toEqual([
      ["isSubmitted = true"],
      ["isClicked = true", "isSubmitted = true"],
      ["isClicked = false"],
      ["isClicked = true"],
    ]);
  });

  it("runs an ancestor's capture handler before the target's", () => {
    expect(getUpdateSequences("Captured")).toEqual([
      ['order = "outer"'],
      ['order = "outer"', 'order = "outer-inner"'],
    ]);
  });
  it("keeps the ancestors after a handler that only sometimes stops propagation", () => {
    expect(getUpdateSequences("MaybeStopped")).toEqual([
      ["outer = outer + 1"],
      ["isLocked = true", "outer = outer + 1"],
    ]);
    expect(getUpdateSequences("MaybeStoppedByCapture")).toEqual([["count = count + 1"]]);
  });

  it("submits the form after a click that only sometimes prevents it", () => {
    expect(getUpdateSequences("MaybePrevented")).toEqual([
      ["isSubmitted = true"],
      ["isHeld = false", "isSubmitted = true"],
    ]);
  });
  it("submits the form after a button whose type is computed or left undefined", () => {
    expect(getUpdateSequences("SubmitByType")).toEqual([
      ["isSent = true"],
      ["isPrimary = false", "isSent = true"],
      ["isPrimary = true", "isSent = true"],
    ]);
  });

  it("enters every ancestor the pointer crosses, outer first, and leaves them inner first", () => {
    expect(getUpdateSequences("EnteredTogether")).toEqual(
      expect.arrayContaining([
        ["isOuter = true", "isInner = true"],
        ["isInner = false", "isOuter = false"],
      ]),
    );
  });

  it("runs the input listeners and then the change listeners for one text input event", () => {
    expect(getUpdateSequences("InputThenChange")).toContainEqual([
      "isInput = true",
      "isChanged = true",
    ]);
  });

  it("clicks a label's control after the label, so the control's click bubbles to the label again", () => {
    const names = getComponent(project, "LabelAroundCheckbox").analysis.handlers.map((handler) =>
      handler.updates.map((update) => update.binding.name),
    );
    expect(names).toContainEqual(["labelClicks", "labelClicks", "isOn"]);
  });

  it("focuses the control a label points to after the label's click", () => {
    const names = getComponent(project, "LabelForField").analysis.handlers.map((handler) =>
      handler.updates.map((update) => update.binding.name),
    );
    expect(names).toContainEqual(["isLabelClicked", "isFocused"]);
  });

  it("runs a form's reset, a remote form's submit and a details toggle after the click", () => {
    const names = getComponent(project, "FormDefaults").analysis.handlers.map((handler) =>
      handler.updates.map((update) => update.binding.name),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        ["clicks", "isReset"],
        ["clicks", "isSent"],
        ["clicks", "isToggled"],
      ]),
    );
  });

  it("runs the default action of the nearest button or label above the clicked element", () => {
    const names = getComponent(project, "NestedActivators").analysis.handlers.map((handler) =>
      handler.updates.map((update) => update.binding.name),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        ["clicks", "isSent"],
        ["clicks", "isOn"],
      ]),
    );
  });

  it("runs the handlers of events a handler dispatches through a ref or the event target", () => {
    const names = getComponent(project, "DispatchedFromHandlers").analysis.handlers.map((handler) =>
      handler.updates
        .filter((update) => update.binding.kind === "state")
        .map((update) => update.binding.name),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        ["clicks", "isFocused"],
        ["clicks", "isReset"],
      ]),
    );
  });

  it("runs an autoFocus input's focus handler after the commit that mounts it", () => {
    const effectUpdates = getComponent(project, "AutoFocused")
      .analysis.handlers.filter((handler) => handler.trigger.kind === "Effect")
      .flatMap((handler) => handler.updates.map((update) => update.binding.name));
    expect(effectUpdates).toContain("isFocused");
  });

  it("runs a child's callback props when a ref the child holds dispatches an event", () => {
    const names = getComponent(project, "FocusThroughChild").analysis.handlers.map((handler) =>
      handler.updates
        .filter((update) => update.binding.kind === "state")
        .map((update) => update.binding.name),
    );
    expect(names).toContainEqual(["clicks", "isFocused"]);
  });
});
