import type { UnaryOperator } from "oxc-parser";
import type { HostRealm } from "../host/host-realm.js";
import { REACT_MEMO_CACHE_SENTINEL_KEY } from "../react/react-api.js";
import type { CompareOperator, GuardLiteral } from "../symbolic/guards.js";
import type { StaticPrimitive, StaticUnknownPrimitiveValue, StaticValue } from "../types.js";
import { isClockDateValue, toDatePrimitive } from "./clock-date.js";
import { isInstanceOf } from "./instance-of.js";
import { getLanguageObject } from "./language-intrinsics.js";
import { getExactLanguageObject, toNativeObjectPrimitive } from "./native-values.js";
import { applyNumberRangeOperator, compareNumberRanges } from "./number-ranges.js";
import { recordBranchOrigin, recordDerivation, recordNegation } from "./predicates.js";
import { concatenateStrings, toStringValue } from "./primitive-shapes.js";
import { getThrowCertainty, getThrownOperand } from "./thrown.js";
import { applyClockOperator } from "./timers.js";
import { getGlobalTypeof, getTypeofValue } from "./value-typeof.js";
import {
  compareIdentity,
  distributeBinary,
  FALSE_VALUE,
  getTruthiness,
  hasDefiniteItems,
  mapValue,
  primitiveValue,
  regExpToString,
  TRUE_VALUE,
  unknownPrimitiveValue,
} from "./values.js";

export const logicalOutcome = (
  joined: StaticValue,
  operator: "&&" | "||",
  left: StaticValue,
  right: StaticValue,
): StaticValue => {
  if (
    (joined.kind !== "unknown-primitive" &&
      joined.kind !== "unknown" &&
      joined.kind !== "branch") ||
    getThrowCertainty(joined) !== "never"
  )
    return joined;
  const result = recordDerivation({ ...joined }, { kind: "logical", operator, left, right });
  if (result.kind === "branch" && joined.kind === "branch") recordBranchOrigin(result, joined);
  return result;
};

export const applyUnaryOperator = (
  operator: Exclude<UnaryOperator, "typeof" | "void" | "delete">,
  argument: StaticValue,
): StaticValue => {
  if (argument.kind === "branch")
    return mapValue(argument, (alternative) => applyUnaryOperator(operator, alternative));
  if (getThrownOperand([argument])) return argument;
  if (operator !== "!" && isCoercibleOperand(argument)) {
    return applyUnaryOperator(operator, toCoercedOperand(argument, "number"));
  }
  switch (operator) {
    case "!": {
      const truthiness = getTruthiness(argument);
      if (truthiness === null) {
        return recordNegation(unknownPrimitiveValue("boolean", "negation of unknown"), argument);
      }
      return truthiness ? FALSE_VALUE : TRUE_VALUE;
    }
    case "-":
      if (argument.kind === "primitive" && typeof argument.value === "number")
        return primitiveValue(-argument.value);
      return unknownPrimitiveValue("number", "unary minus");
    case "+":
      if (argument.kind === "primitive" && typeof argument.value !== "bigint")
        return primitiveValue(Number(argument.value));
      return unknownPrimitiveValue("number", "unary plus");
    case "~":
      if (argument.kind === "primitive" && typeof argument.value === "number")
        return primitiveValue(~argument.value);
      return unknownPrimitiveValue("number", "bitwise not");
  }
};

export const applyBinaryOperator = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
  realm: HostRealm | null = null,
): StaticValue => {
  if (operator === "+" && (hasDefiniteItems(left) || hasDefiniteItems(right))) {
    return applyBinaryOperator(
      operator,
      hasDefiniteItems(left) ? toStringValue(left) : left,
      hasDefiniteItems(right) ? toStringValue(right) : right,
      realm,
    );
  }
  const distributed = distributeBinary(left, right, (leftAlternative, rightAlternative) =>
    applyBinaryOperator(operator, leftAlternative, rightAlternative, realm),
  );
  if (distributed) return distributed;
  const thrownOperand = getThrownOperand([left, right]);
  if (thrownOperand) return thrownOperand;
  const coercionHint = getCoercionHint(operator, left, right);
  if (coercionHint !== null && (isCoercibleOperand(left) || isCoercibleOperand(right))) {
    return applyBinaryOperator(
      operator,
      toCoercedOperand(left, coercionHint),
      toCoercedOperand(right, coercionHint),
      realm,
    );
  }
  if (left.kind === "primitive" && right.kind === "primitive") {
    const computed = computeBinary(operator, left.value, right.value);
    if (computed !== undefined) return computed;
  }
  const equality = compareEquality(operator, left, right, realm);
  if (equality) return equality;
  if (operator === "instanceof") {
    const isInstance = isInstanceOf(left, right, realm);
    if (isInstance !== null) return primitiveValue(isInstance);
  }
  const timed = applyClockOperator(operator, left, right);
  if (timed) return timed;
  const ordered =
    compareNumberRanges(operator, left, right) ?? applyNumberRangeOperator(operator, left, right);
  if (ordered) return ordered;
  switch (operator) {
    case "==":
    case "!=":
    case "===":
    case "!==":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return deriveComparison(
        operator,
        left,
        right,
        unknownPrimitiveValue("boolean", `${operator} on dynamic values`),
      );
    case "instanceof":
    case "in":
      return unknownPrimitiveValue("boolean", `${operator} on dynamic values`);
    case "+": {
      const isString =
        (left.kind === "primitive" && typeof left.value === "string") ||
        (right.kind === "primitive" && typeof right.value === "string") ||
        (left.kind === "unknown-primitive" && left.primitiveType === "string") ||
        (right.kind === "unknown-primitive" && right.primitiveType === "string");
      if (isString) return concatenateStrings(left, right);
      return isNumberValue(left) && isNumberValue(right)
        ? unknownPrimitiveValue("number", "+ on dynamic values")
        : unknownPrimitiveValue("any", "+ on dynamic values");
    }
    default:
      return unknownPrimitiveValue("number", `${operator} on dynamic values`);
  }
};

/**
 * The `ToPrimitive` hint an operator applies to an object operand; null for
 * operators that compare objects by identity (and `==` between two objects).
 */
const getCoercionHint = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
): "default" | "number" | null => {
  switch (operator) {
    case "+":
      return "default";
    case "==":
    case "!=":
      return left.kind === "primitive" || right.kind === "primitive" ? "default" : null;
    case "===":
    case "!==":
    case "instanceof":
    case "in":
      return null;
    default:
      return "number";
  }
};

const isCoercibleOperand = (value: StaticValue): boolean =>
  value.kind === "regexp" || value.kind === "native-object" || isClockDateValue(value);

/** `ToPrimitive` of an object operand: `RegExp.prototype.toString`, a modeled date's time, or the native object's own conversion. */
const toCoercedOperand = (value: StaticValue, hint: "default" | "number"): StaticValue => {
  if (value.kind === "regexp") return primitiveValue(regExpToString(value));
  if (value.kind === "native-object") return toNativeObjectPrimitive(value, hint);
  return toDatePrimitive(value, hint) ?? value;
};

/** A value that is a number for sure, known or not. */
const isNumberValue = (value: StaticValue): boolean =>
  value.kind === "primitive"
    ? typeof value.value === "number"
    : value.kind === "unknown-primitive" && value.primitiveType === "number";

const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);

const OBJECT_VALUE_KINDS: ReadonlySet<StaticValue["kind"]> = new Set([
  "element",
  "list",
  "object",
  "function",
  "class",
  "regexp",
  "context",
  "react-api",
  "namespace",
  "native-object",
  "method",
  "native-function",
  "proxy",
]);

const COMPARE_OPERATORS: Partial<Record<string, CompareOperator>> = {
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
};

const MIRRORED_COMPARISONS: Record<CompareOperator, CompareOperator> = {
  "<": ">",
  "<=": ">=",
  ">": "<",
  ">=": "<=",
};

/** Guards are serialized as JSON, where only finite numbers survive. */
const isGuardLiteral = (value: StaticPrimitive): value is GuardLiteral =>
  typeof value !== "bigint" &&
  value !== undefined &&
  (typeof value !== "number" || Number.isFinite(value));

/** Records an undecided comparison of a dynamic operand against a literal as a guard over that operand. */
const deriveComparison = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
  result: StaticUnknownPrimitiveValue,
): StaticValue => {
  const isMirrored = right.kind !== "primitive";
  const [operand, literalSide] = isMirrored ? [right, left] : [left, right];
  if (literalSide.kind !== "primitive") return result;
  const literal = literalSide.value;
  if (EQUALITY_OPERATORS.has(operator)) {
    if (literal !== undefined && !isGuardLiteral(literal)) return result;
    return recordDerivation(result, {
      kind: "equality",
      operand,
      literal,
      isStrict: operator === "===" || operator === "!==",
      isNegated: operator === "!==" || operator === "!=",
    });
  }
  const compareOperator = COMPARE_OPERATORS[operator];
  if (compareOperator === undefined || typeof literal !== "number" || !Number.isFinite(literal)) {
    return result;
  }
  return recordDerivation(result, {
    kind: "comparison",
    operand,
    operator: isMirrored ? MIRRORED_COMPARISONS[compareOperator] : compareOperator,
    literal,
  });
};

/** Loose equality only differs from identity when both sides can coerce; null, undefined and symbols never do. */
const mayCoerce = (value: StaticValue): boolean =>
  value.kind === "primitive"
    ? value.value !== null && value.value !== undefined
    : value.kind !== "symbol";

/** Whether a value is an object (a global like `Date` is one once the host fixes its `typeof`). */
const isObjectValue = (value: StaticValue, realm: HostRealm | null): boolean => {
  if (OBJECT_VALUE_KINDS.has(value.kind)) return true;
  if (realm === null || value.kind === "primitive") return false;
  const typeofValue = getTypeofValue(value, realm);
  return (
    typeofValue.kind === "primitive" &&
    (typeofValue.value === "object" || typeofValue.value === "function")
  );
};

/** Two objects compare by identity under `==` as well: coercion needs a primitive operand. */
const mayCoerceTogether = (
  left: StaticValue,
  right: StaticValue,
  realm: HostRealm | null,
): boolean =>
  mayCoerce(left) &&
  mayCoerce(right) &&
  !(isObjectValue(left, realm) && isObjectValue(right, realm));

/** `"" == Date`, `Object("a") == "a"`: what loosely comparing a primitive to a language object yields in this process, which implements the same language. */
const compareLanguageObjectLoosely = (left: StaticValue, right: StaticValue): boolean | null => {
  if (right.kind !== "primitive") return null;
  const object: unknown =
    left.kind === "global"
      ? getLanguageObject(left.name)
      : left.kind === "native-object"
        ? getExactLanguageObject(left)
        : null;
  // eslint-disable-next-line eqeqeq
  return object === null ? null : object == right.value;
};

/** Whether a host global equals `undefined`/`null`, once the host fixes its `typeof`. */
const compareGlobalToNullish = (
  global: StaticValue,
  other: StaticValue,
  realm: HostRealm | null,
): boolean | null => {
  if (realm === null || global.kind !== "global" || other.kind !== "primitive") return null;
  if (other.value !== undefined && other.value !== null) return null;
  const globalTypeof = getGlobalTypeof(global.name, realm);
  if (globalTypeof === null) return null;
  return globalTypeof === "undefined" ? other.value === undefined : false;
};

const compareEquality = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
  realm: HostRealm | null,
): StaticValue | null => {
  if (!EQUALITY_OPERATORS.has(operator)) return null;
  const isStrict = operator === "===" || operator === "!==";
  let isEqual =
    compareIdentity(left, right) ??
    compareGlobalToNullish(left, right, realm) ??
    compareGlobalToNullish(right, left, realm);
  if (isEqual === false && !isStrict && mayCoerceTogether(left, right, realm)) {
    isEqual =
      compareLanguageObjectLoosely(left, right) ?? compareLanguageObjectLoosely(right, left);
  }
  if (isEqual === null) {
    const isSentinel = (value: StaticValue): boolean =>
      value.kind === "symbol" && value.key === REACT_MEMO_CACHE_SENTINEL_KEY;
    if (!isSentinel(left) && !isSentinel(right)) return null;
    isEqual = false;
  }
  return primitiveValue(operator === "===" || operator === "==" ? isEqual : !isEqual);
};

const computeBinary = (
  operator: string,
  left: StaticPrimitive,
  right: StaticPrimitive,
): StaticValue | undefined => {
  switch (operator) {
    case "===":
      return primitiveValue(left === right);
    case "!==":
      return primitiveValue(left !== right);
    case "==":
      // eslint-disable-next-line eqeqeq
      return primitiveValue(left == right);
    case "!=":
      // eslint-disable-next-line eqeqeq
      return primitiveValue(left != right);
    default:
      break;
  }
  if (typeof left === "bigint" || typeof right === "bigint") return undefined;
  if (typeof left === "string" || typeof right === "string") {
    if (operator === "+") return primitiveValue(String(left) + String(right));
  }
  if (typeof left === "string" && typeof right === "string") {
    switch (operator) {
      case "<":
        return primitiveValue(left < right);
      case "<=":
        return primitiveValue(left <= right);
      case ">":
        return primitiveValue(left > right);
      case ">=":
        return primitiveValue(left >= right);
      default:
        break;
    }
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  switch (operator) {
    case "+":
      return primitiveValue(leftNumber + rightNumber);
    case "-":
      return primitiveValue(leftNumber - rightNumber);
    case "*":
      return primitiveValue(leftNumber * rightNumber);
    case "/":
      return primitiveValue(leftNumber / rightNumber);
    case "%":
      return primitiveValue(leftNumber % rightNumber);
    case "**":
      return primitiveValue(leftNumber ** rightNumber);
    case "<":
      return primitiveValue(leftNumber < rightNumber);
    case "<=":
      return primitiveValue(leftNumber <= rightNumber);
    case ">":
      return primitiveValue(leftNumber > rightNumber);
    case ">=":
      return primitiveValue(leftNumber >= rightNumber);
    case "&":
      return primitiveValue(leftNumber & rightNumber);
    case "|":
      return primitiveValue(leftNumber | rightNumber);
    case "^":
      return primitiveValue(leftNumber ^ rightNumber);
    case "<<":
      return primitiveValue(leftNumber << rightNumber);
    case ">>":
      return primitiveValue(leftNumber >> rightNumber);
    case ">>>":
      return primitiveValue(leftNumber >>> rightNumber);
    default:
      return undefined;
  }
};
