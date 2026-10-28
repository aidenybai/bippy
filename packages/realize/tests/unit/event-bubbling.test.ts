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

  it("runs an ancestor's onError after an image's, since React propagates it", () => {
    expect(getUpdateSequences("ImageErrorBubbles")).toContainEqual([
      "isBroken = true",
      "failures = 1",
    ]);
  });

  it("keeps onScroll on its own element", () => {
    expect(getUpdateSequences("ScrollStaysOnTarget")).toEqual([["outer = true"], ["inner = true"]]);
  });

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

  it("runs a form's reset and a remote form's submit after the click", () => {
    const names = getComponent(project, "FormDefaults").analysis.handlers.map((handler) =>
      handler.updates.map((update) => update.binding.name),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        ["clicks", "isReset"],
        ["clicks", "isSent"],
      ]),
    );
  });

  it("bubbles a button's submit and reset through the form's ancestors", () => {
    const names = getComponent(project, "BubbledFormEvents").analysis.handlers.map((handler) =>
      handler.updates.map((update) => update.binding.name),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        ["clicks", "isCaptured", "isSent"],
        ["clicks", "isReset"],
      ]),
    );
  });

  it("runs a details toggle after the click's commit, with the state the click set", () => {
    const handlers = getComponent(project, "ToggleAfterClick").analysis.handlers;
    const effectUpdates = handlers
      .filter((handler) => handler.trigger.kind === "Effect")
      .flatMap((handler) => handler.updates.map((update) => update.binding.name));
    expect(effectUpdates).toContain("count");
    expect(getUpdateSequences("ToggleAfterClick")).toContainEqual(["count = 1"]);
  });

  it("may skip a text input's change handler, which React runs only when the value changed", () => {
    const updates = getComponent(project, "UnchangedInput").analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => [update.binding.name, update.guards.length > 0]),
    );
    expect(updates).toContainEqual(["inputs", false]);
    expect(updates).toContainEqual(["changes", true]);
    expect(updates).not.toContainEqual(["changes", false]);
  });

  it("runs an element's own capture handler before its bubble handler and its ancestors'", () => {
    const names = getComponent(project, "TargetCapture").analysis.handlers.map((handler) =>
      handler.updates.map((update) => update.binding.name),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        ["order", "order", "isOuter"],
        ["isCaptured", "isOuter"],
      ]),
    );
  });

  it("treats a preventDefault behind a maybe-stopped handler as a maybe", () => {
    const sent = getComponent(project, "MaybeStoppedPrevent")
      .analysis.handlers.filter(
        (handler) => handler.trigger.kind === "Event" && handler.trigger.tag === "button",
      )
      .flatMap((handler) => handler.updates)
      .filter((update) => update.binding.name === "isSent");
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((update) => update.guards.length > 0)).toBe(true);
  });

  it("runs a checkbox's input handler after the click's commit as well", () => {
    const effectUpdates = getComponent(project, "InputAfterCommit")
      .analysis.handlers.filter((handler) => handler.trigger.kind === "Effect")
      .flatMap((handler) => handler.updates.map((update) => update.binding.name));
    expect(effectUpdates).toContain("isSeen");
  });

  it("runs a checkbox's input handler after its click unless the click is prevented", () => {
    const sequences = getUpdateSequences("CheckboxInput");
    expect(sequences).toContainEqual(["clicks = 1", "inputs = 1"]);
    expect(sequences).not.toContainEqual(["clicks = 2", "inputs = 2"]);
  });

  it("clicks a label's text field after focusing it", () => {
    const names = getComponent(project, "LabelClicksField").analysis.handlers.map((handler) =>
      handler.updates.map((update) => update.binding.name),
    );
    expect(names).toContainEqual(["isLabelClicked", "isClicked"]);
  });

  it("may skip an ancestor's bubble handler after its capture handler, since a descendant may stop the click", () => {
    const guarded = getComponent(project, "CaptureAboveStop").analysis.handlers.map((handler) =>
      handler.updates
        .filter((update) => update.binding.name === "isOpened")
        .map((update) => update.guards.length > 0),
    );
    expect(guarded).toContainEqual([true]);
    expect(guarded).toContainEqual([false]);
  });

  it("may skip a label's activation after a click inside it, since the click may target interactive content", () => {
    const isOn = getComponent(project, "ClickInsideLabel")
      .analysis.handlers.filter(
        (handler) => handler.trigger.kind === "Event" && handler.trigger.tag === "div",
      )
      .flatMap((handler) => handler.updates)
      .filter((update) => update.binding.name === "isOn");
    expect(isOn.length).toBeGreaterThan(0);
    expect(isOn.every((update) => update.guards.length > 0)).toBe(true);
  });

  it("activates the first rendered element with a label's htmlFor id, only while it renders and is enabled", () => {
    const getLabelUpdates = (name: string) =>
      getComponent(project, name)
        .analysis.handlers.filter(
          (handler) => handler.trigger.kind === "Event" && handler.trigger.tag === "label",
        )
        .flatMap((handler) => handler.updates)
        .map((update) => ({
          update: `${update.binding.name} = ${formatSymbolicValue(update.value)}`,
          guards: update.guards.map(formatSymbolicValue),
        }));
    expect(getLabelUpdates("SwappedLabelTarget")).toEqual([
      { update: 'mode = "editing"', guards: ["isEditing"] },
      { update: 'mode = "viewing"', guards: ["!isEditing", "!isEditing"] },
    ]);
    expect(getLabelUpdates("MissingLabelTarget")).toEqual([
      { update: "isOn = !isOn", guards: ["isShown"] },
    ]);
    expect(getLabelUpdates("DisabledLabelTarget")).toEqual([
      { update: "isOn = !isOn", guards: ["!isLocked"] },
    ]);
    expect(getLabelUpdates("UseIdLabel")).toEqual([{ update: "isOn = !isOn", guards: [] }]);
  });

  it("skips a disabled ancestor's click handler, which React drops for a click on its descendant", () => {
    const presses = getComponent(project, "DisabledAncestorClick")
      .analysis.handlers.filter(
        (handler) => handler.trigger.kind === "Event" && handler.trigger.tag === "span",
      )
      .flatMap((handler) => handler.updates)
      .map((update) => update.guards.map(formatSymbolicValue));
    expect(presses).toEqual([["!isLocked"]]);
  });

  it("submits a form after a click inside its submit button only while the button is enabled", () => {
    const sent = getComponent(project, "DisabledSubmitIcon")
      .analysis.handlers.filter(
        (handler) => handler.trigger.kind === "Event" && handler.trigger.tag === "span",
      )
      .flatMap((handler) => handler.updates)
      .map((update) => update.guards.map(formatSymbolicValue));
    expect(sent).toEqual([["!isLocked"]]);
  });

  it("may skip what follows a child component that stops or prevents the click inside it", () => {
    const getGuarded = (name: string, binding: string) =>
      getComponent(project, name)
        .analysis.handlers.filter(
          (handler) =>
            handler.trigger.kind === "Event" &&
            (handler.trigger.tag === "button" || handler.trigger.tag === "span"),
        )
        .flatMap((handler) => handler.updates)
        .filter((update) => update.binding.name === binding)
        .map((update) => update.guards.length > 0);
    expect(getGuarded("StoppedInChild", "isOpen")).toEqual([true]);
    expect(getGuarded("StoppedInChild", "count")).toEqual([false]);
    expect(getGuarded("PreventedInChild", "isSent")).toEqual([true]);
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

  it("runs the form action, or the submitter's formAction, after a submit button's click", () => {
    const names = getComponent(project, "ClickThenFormAction").analysis.handlers.map((handler) =>
      handler.updates.map((update) => update.binding.name),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        ["clicks", "isSaved"],
        ["clicks", "isAlternate"],
      ]),
    );
  });
});
