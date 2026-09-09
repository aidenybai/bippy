import type { StaticValue } from "../types.js";
import { getKnownObjectKeys } from "./values.js";

const ELEMENT_TYPE_TAG_KEY = "$$typeof";

/** Whether `value` satisfies a runtime type test; `null` when the value does not decide it. */
export interface TypePredicate {
  (value: StaticValue): boolean | null;
}

const isUndecided = (value: StaticValue): boolean =>
  value.kind === "unknown" ||
  value.kind === "branch" ||
  value.kind === "optional" ||
  value.kind === "external" ||
  value.kind === "proxy";

/** `isValidElement`: `object.$$typeof === REACT_ELEMENT_TYPE`, so a program object whose keys are known and lack the tag is decided. */
export const isElementValue: TypePredicate = (value) => {
  switch (value.kind) {
    case "element":
      return true;
    case "object": {
      const keys = getKnownObjectKeys(value);
      return keys !== null && !keys.includes(ELEMENT_TYPE_TAG_KEY) ? false : null;
    }
    case "unknown-primitive":
      return value.primitiveType === "any" ? null : false;
    default:
      return isUndecided(value) ? null : false;
  }
};

export const isArrayValue: TypePredicate = (value) =>
  value.kind === "list" || value.kind === "repeat" ? true : isUndecided(value) ? null : false;

export interface CalleeTypePredicate {
  name: string;
  test: TypePredicate;
}

/** The type test a callee performs on its single argument, for `isValidElement(x)` and `Array.isArray(x)`. */
export const getTypePredicate = (callee: StaticValue): CalleeTypePredicate | null => {
  if (callee.kind === "react-api" && callee.api === "isValidElement")
    return { name: "isValidElement", test: isElementValue };
  if (callee.kind === "global" && callee.name === "Array.isArray")
    return { name: "Array.isArray", test: isArrayValue };
  return null;
};
