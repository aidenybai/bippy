import { useReducer } from "react";

export interface EditableValueState {
  editableValue: string;
  externalValue: unknown;
  hasPendingChanges: boolean;
  isValid: boolean;
  parsedValue: unknown;
}

export interface EditableValueAction {
  editableValue?: string;
  externalValue: unknown;
  type: "RESET" | "UPDATE";
}

const smartStringify = (value: unknown): string => {
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
  }
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
};

const smartParse = (value: string): unknown => {
  if (value === "Infinity") return Infinity;
  if (value === "-Infinity") return -Infinity;
  if (value === "NaN") return NaN;
  if (value === "undefined") return undefined;
  const sanitizedValue =
    value.length >= 2 && value.startsWith("'") && value.endsWith("'")
      ? `"${value.slice(1, -1)}"`
      : value;
  return JSON.parse(sanitizedValue);
};

const reduceEditableValue = (
  state: EditableValueState,
  action: EditableValueAction,
): EditableValueState => {
  if (action.type === "RESET") {
    return {
      editableValue: smartStringify(action.externalValue),
      externalValue: action.externalValue,
      hasPendingChanges: false,
      isValid: true,
      parsedValue: action.externalValue,
    };
  }
  if (action.type !== "UPDATE" || action.editableValue === undefined) {
    throw new Error(`Invalid action "${action.type}"`);
  }
  let isValid = false;
  let parsedValue = state.parsedValue;
  try {
    parsedValue = smartParse(action.editableValue);
    isValid = true;
  } catch {}
  return {
    editableValue: action.editableValue,
    externalValue: action.externalValue,
    hasPendingChanges: smartStringify(action.externalValue) !== action.editableValue,
    isValid,
    parsedValue,
  };
};

export const useEditableValue = (
  externalValue: unknown,
): [EditableValueState, (action: EditableValueAction) => void] => {
  const [state, dispatch] = useReducer(reduceEditableValue, {
    editableValue: smartStringify(externalValue),
    externalValue,
    hasPendingChanges: false,
    isValid: true,
    parsedValue: externalValue,
  });
  if (!Object.is(state.externalValue, externalValue)) {
    dispatch(
      state.hasPendingChanges
        ? {
            editableValue: state.editableValue,
            externalValue,
            type: "UPDATE",
          }
        : { externalValue, type: "RESET" },
    );
  }
  return [state, dispatch];
};
