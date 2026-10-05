// Boolean comparison normalization adapted from TypeScript. See ../../third-party-notices.md.
import type { UnaryOperator } from "oxc-parser";
import type { HostRealm } from "../host/host-realm.js";
import { REACT_MEMO_CACHE_SENTINEL_KEY } from "../react/react-api.js";
import type { CompareOperator, GuardLiteral } from "../symbolic/guards.js";
import type { StaticPrimitive, StaticUnknownPrimitiveValue, StaticValue } from "../types.js";
import { isClockDateValue, toDatePrimitive } from "./clock-date.js";
import { createErrorValue } from "./errors.js";
import { isInstanceOf, isOnFunctionPrototypeChain } from "./instance-of.js";
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
  getObjectProperty,
  hasDefiniteItems,
  mapValue,
  primitiveValue,
  regExpToString,
  thrownValue,
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

const getNumericTypeError = (message: string, reason = message): StaticValue =>
  thrownValue(reason, createErrorValue("TypeError", [primitiveValue(message)], null), null);

const evaluateFailingBigIntOperation = (operation: () => bigint): StaticValue => {
  try {
    return primitiveValue(operation());
  } catch (error) {
    const message =
      error instanceof Error
        ? primitiveValue(error.message)
        : unknownPrimitiveValue("string", "BigInt error message");
    return thrownValue("BigInt operation threw", createErrorValue("RangeError", [message], null));
  }
};

const BIGINT_NUMERIC_OPERATORS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
]);

const RELATIONAL_OPERATORS = new Set(["<", ">", "<=", ">="]);

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
  if (operator !== "!" && argument.kind === "symbol")
    return getNumericTypeError("Cannot convert a Symbol value to a number");
  switch (operator) {
    case "!": {
      const truthiness = getTruthiness(argument);
      if (truthiness === null) {
        return recordNegation(unknownPrimitiveValue("boolean", "negation of unknown"), argument);
      }
      return truthiness ? FALSE_VALUE : TRUE_VALUE;
    }
    case "-":
      if (argument.kind === "primitive")
        return primitiveValue(
          typeof argument.value === "bigint" ? -argument.value : -Number(argument.value),
        );
      return unknownPrimitiveValue(getNumericType(argument), "unary minus");
    case "+":
      if (argument.kind === "primitive") {
        if (typeof argument.value === "bigint")
          return getNumericTypeError(
            "Cannot convert a BigInt value to a number",
            "unary plus on BigInt",
          );
        return primitiveValue(Number(argument.value));
      }
      return unknownPrimitiveValue("number", "unary plus");
    case "~":
      if (argument.kind === "primitive")
        return primitiveValue(
          typeof argument.value === "bigint" ? ~argument.value : ~Number(argument.value),
        );
      return unknownPrimitiveValue(getNumericType(argument), "bitwise not");
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
  if (operator === "instanceof" && right.kind === "function") {
    const prototype = getObjectProperty((right.boundTarget ?? right).properties, "prototype");
    if (prototype.kind === "branch")
      return (
        distributeBinary(left, prototype, (instance, selectedPrototype) => {
          const result = isOnFunctionPrototypeChain(instance, selectedPrototype);
          return result === null
            ? unknownPrimitiveValue("boolean", "instanceof on dynamic values")
            : primitiveValue(result);
        }) ??
        unknownPrimitiveValue("boolean", "instanceof exceeds supported prototype alternatives")
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
  if (
    (left.kind === "symbol" || right.kind === "symbol") &&
    (BIGINT_NUMERIC_OPERATORS.has(operator) || RELATIONAL_OPERATORS.has(operator))
  )
    return getNumericTypeError(
      `Cannot convert a Symbol value to a ${operator === "+" && (isStringValue(left) || isStringValue(right)) ? "string" : "number"}`,
    );
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
  if (isBigIntMixture(operator, left, right) || isBigIntMixture(operator, right, left))
    return getNumericTypeError("Cannot mix BigInt and other types, use explicit conversions");
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
      if (isStringValue(left) || isStringValue(right)) return concatenateStrings(left, right);
      return isNeverBigInt(left) && isNeverBigInt(right)
        ? unknownPrimitiveValue("number", "+ on dynamic values")
        : unknownPrimitiveValue("any", "+ on dynamic values");
    }
    default:
      return unknownPrimitiveValue(
        operator === ">>>" ? "number" : getNumericType(left, right),
        `${operator} on dynamic values`,
      );
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

const isStringValue = (value: StaticValue): boolean =>
  value.kind === "primitive"
    ? typeof value.value === "string"
    : value.kind === "unknown-primitive" && value.primitiveType === "string";

const isNeverBigInt = (value: StaticValue): boolean =>
  value.kind === "primitive"
    ? typeof value.value !== "bigint"
    : value.kind === "unknown-primitive" && value.primitiveType !== "any";

/** A numeric result is a Number unless every operand may be a BigInt; a mixture throws instead. */
const getNumericType = (...operands: StaticValue[]): "number" | "any" =>
  operands.some(isNeverBigInt) ? "number" : "any";

const isBigIntMixture = (operator: string, bigint: StaticValue, other: StaticValue): boolean =>
  BIGINT_NUMERIC_OPERATORS.has(operator) &&
  bigint.kind === "primitive" &&
  typeof bigint.value === "bigint" &&
  other.kind === "unknown-primitive" &&
  (other.primitiveType === "boolean" ||
    other.primitiveType === "number" ||
    (other.primitiveType === "string" && operator !== "+"));

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

/** `==` between a typed primitive and a literal of another type compares numbers: `false == "0e16"`, `count == "1"`. */
const deriveLooseEquality = (
  operand: StaticUnknownPrimitiveValue,
  numericLiteral: number,
  isNegated: boolean,
  result: StaticUnknownPrimitiveValue,
): StaticValue => {
  if (operand.primitiveType === "string") return result;
  if (operand.primitiveType === "boolean") {
    if (numericLiteral !== 0 && numericLiteral !== 1) return primitiveValue(isNegated);
    return (numericLiteral === 1) !== isNegated
      ? recordDerivation(result, { kind: "alias", operand })
      : recordNegation(result, operand);
  }
  if (Number.isNaN(numericLiteral)) return primitiveValue(isNegated);
  if (!Number.isFinite(numericLiteral)) return result;
  return recordDerivation(result, {
    kind: "equality",
    operand,
    literal: numericLiteral,
    isStrict: true,
    isNegated,
  });
};

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
    const isStrict = operator === "===" || operator === "!==";
    const isNegated = operator === "!==" || operator === "!=";
    if (
      operand.kind === "unknown-primitive" &&
      operand.primitiveType === "boolean" &&
      typeof literal === "boolean"
    ) {
      return literal !== isNegated
        ? recordDerivation(result, { kind: "alias", operand })
        : recordNegation(result, operand);
    }
    if (
      !isStrict &&
      operand.kind === "unknown-primitive" &&
      operand.primitiveType !== "any" &&
      literal !== null &&
      literal !== undefined &&
      typeof literal !== operand.primitiveType
    ) {
      return deriveLooseEquality(operand, Number(literal), isNegated, result);
    }
    return recordDerivation(result, { kind: "equality", operand, literal, isStrict, isNegated });
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

const MAX_BIGINT_BITS = 4096n;

const getBitLength = (value: bigint): bigint =>
  BigInt((value < 0n ? -value : value).toString(2).length);

const BIGINT_OPERATIONS: Record<string, (left: bigint, right: bigint) => bigint> = {
  "+": (left, right) => left + right,
  "-": (left, right) => left - right,
  "*": (left, right) => left * right,
  "/": (left, right) => left / right,
  "%": (left, right) => left % right,
  "**": (left, right) => left ** right,
  "&": (left, right) => left & right,
  "|": (left, right) => left | right,
  "^": (left, right) => left ^ right,
  "<<": (left, right) => left << right,
  ">>": (left, right) => left >> right,
};

/** Exact BigInt arithmetic while operands and results stay within a few thousand bits. */
const computeBoundedBigInt = (
  operator: string,
  left: bigint,
  right: bigint,
): StaticValue | undefined => {
  if (getBitLength(left) > MAX_BIGINT_BITS || getBitLength(right) > MAX_BIGINT_BITS)
    return undefined;
  if (operator === "**" && getBitLength(left) * right > MAX_BIGINT_BITS) return undefined;
  if (
    (operator === "<<" || operator === ">>") &&
    (right > MAX_BIGINT_BITS || right < -MAX_BIGINT_BITS)
  )
    return undefined;
  return primitiveValue(BIGINT_OPERATIONS[operator](left, right));
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
  if (typeof left === "bigint" && typeof right === "bigint") {
    switch (operator) {
      case "<":
        return primitiveValue(left < right);
      case ">":
        return primitiveValue(left > right);
      case "<=":
        return primitiveValue(left <= right);
      case ">=":
        return primitiveValue(left >= right);
      case ">>>":
        return getNumericTypeError("BigInts have no unsigned right shift, use >> instead");
      default:
        if (!(operator in BIGINT_OPERATIONS)) return undefined;
        return ((operator === "/" || operator === "%") && right === 0n) ||
          (operator === "**" && right < 0n)
          ? evaluateFailingBigIntOperation(() => BIGINT_OPERATIONS[operator](left, right))
          : computeBoundedBigInt(operator, left, right);
    }
  }
  if (typeof left === "bigint" || typeof right === "bigint") {
    return BIGINT_NUMERIC_OPERATORS.has(operator) &&
      !(operator === "+" && (typeof left === "string" || typeof right === "string"))
      ? getNumericTypeError("Cannot mix BigInt and other types, use explicit conversions")
      : undefined;
  }
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
