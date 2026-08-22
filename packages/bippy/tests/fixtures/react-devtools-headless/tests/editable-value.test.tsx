import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { useEditableValue } from "../src/editable-value.js";
import type { EditableValueAction, EditableValueState } from "../src/editable-value.js";

interface ExampleProps {
  value: unknown;
}

let currentState: EditableValueState;
let dispatch: (action: EditableValueAction) => void;

const Example = ({ value }: ExampleProps) => {
  [currentState, dispatch] = useEditableValue(value);
  return null;
};

const expectState = (
  editableValue: string,
  externalValue: unknown,
  parsedValue: unknown,
  hasPendingChanges: boolean,
  isValid: boolean,
): void => {
  expect(currentState).toEqual({
    editableValue,
    externalValue,
    hasPendingChanges,
    isValid,
    parsedValue,
  });
};

afterEach(cleanup);

describe("upstream useEditableValue behavior", () => {
  it("should not cause a loop with values like NaN", () => {
    render(<Example value={Number.NaN} />);
    expectState("NaN", Number.NaN, Number.NaN, false, true);
  });

  it("should override editable state when external props are updated", () => {
    const view = render(<Example value={1} />);
    expectState("1", 1, 1, false, true);
    view.rerender(<Example value={2} />);
    expectState("2", 2, 2, false, true);
  });

  it("should not override editable state when external props are updated if there are pending changes", () => {
    const view = render(<Example value={1} />);
    act(() => dispatch({ editableValue: "2", externalValue: 1, type: "UPDATE" }));
    expectState("2", 1, 2, true, true);
    view.rerender(<Example value={3} />);
    expectState("2", 3, 2, true, true);
  });

  it("should parse edits to ensure valid JSON", () => {
    render(<Example value={1} />);
    act(() => dispatch({ editableValue: '"a', externalValue: 1, type: "UPDATE" }));
    expectState('"a', 1, 1, true, false);
  });

  it("supports special numeric and undefined values", () => {
    const view = render(<Example value={Infinity} />);
    expectState("Infinity", Infinity, Infinity, false, true);
    view.rerender(<Example value={-Infinity} />);
    expectState("-Infinity", -Infinity, -Infinity, false, true);
    view.rerender(<Example value={undefined} />);
    expectState("undefined", undefined, undefined, false, true);
    act(() => dispatch({ editableValue: "Infinity", externalValue: undefined, type: "UPDATE" }));
    expect(currentState.parsedValue).toBe(Infinity);
    act(() => dispatch({ editableValue: "-Infinity", externalValue: undefined, type: "UPDATE" }));
    expect(currentState.parsedValue).toBe(-Infinity);
    act(() => dispatch({ editableValue: "NaN", externalValue: undefined, type: "UPDATE" }));
    expect(currentState.parsedValue).toBeNaN();
    act(() => dispatch({ editableValue: "undefined", externalValue: null, type: "UPDATE" }));
    expect(currentState.parsedValue).toBeUndefined();
  });

  it("should reset to external value upon request", () => {
    render(<Example value={1} />);
    act(() => dispatch({ editableValue: "2", externalValue: 1, type: "UPDATE" }));
    expectState("2", 1, 2, true, true);
    act(() => dispatch({ externalValue: 1, type: "RESET" }));
    expectState("1", 1, 1, false, true);
  });
});
