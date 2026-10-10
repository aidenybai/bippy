import { assertExhaustive } from "../utils/utils.js";
import type {
  AbstractValue,
  Binding,
  BindingValue,
  PrimitiveValue,
  SymbolicValue,
  Truthiness,
} from "./types.js";

const BINARY_PRECEDENCE = new Map<string, number>([
  ["??", 1],
  ["||", 2],
  ["&&", 3],
  ["===", 4],
  ["!==", 4],
  ["==", 4],
  ["!=", 4],
  ["<", 5],
  [">", 5],
  ["<=", 5],
  [">=", 5],
  ["+", 6],
  ["-", 6],
  ["*", 7],
  ["/", 7],
  ["%", 7],
]);

const ATOMIC_PRECEDENCE = 10;

const NEGATED_OPERATORS = new Map<string, string>([
  ["===", "!=="],
  ["!==", "==="],
  ["==", "!="],
  ["!=", "=="],
  ["<", ">="],
  [">", "<="],
  ["<=", ">"],
  [">=", "<"],
]);

export const getNegatedOperator = (operator: string): string | null =>
  NEGATED_OPERATORS.get(operator) ?? null;

export const getPlaceKey = (binding: Binding, path: readonly string[]): string =>
  [String(binding.id), ...path].join(".");

export const getBindingPlaceKey = (value: BindingValue): string =>
  getPlaceKey(value.binding, value.path);

export const formatPlace = (binding: Binding, path: readonly string[]): string =>
  [binding.name, ...path].join(".");

export const formatPrimitive = (value: PrimitiveValue): string =>
  typeof value === "string" ? JSON.stringify(value) : String(value);

export const formatAbstractValue = (value: AbstractValue): string =>
  value.kind === "Literal" ? formatPrimitive(value.value) : value.text;

export const getTruthiness = (value: AbstractValue): Truthiness => {
  if (value.kind === "Literal") return value.value ? "truthy" : "falsy";
  if (value.text === "void") return "falsy";
  return value.primitive === null ? "truthy" : "either";
};

const isNullish = (value: PrimitiveValue): boolean => value === null || value === undefined;

/**
 * Whether `value` satisfies `value <operator> literal` for `===`/`==` (negations are
 * the caller's job). `==` treats `null` and `undefined` as equal.
 */
export const isEqualToLiteral = (
  value: AbstractValue,
  literal: PrimitiveValue,
  operator: string,
): boolean => {
  if (value.kind !== "Literal") return false;
  if ((operator === "==" || operator === "!=") && isNullish(literal)) return isNullish(value.value);
  return value.value === literal;
};

/**
 * Whether a value of type `value` could equal `literal`. `string` could be `"a"`; `User` can't be `null`.
 */
export const canTypeEqualLiteral = (value: AbstractValue, literal: PrimitiveValue): boolean => {
  if (value.kind === "Literal") return false;
  if (value.text === "any" || value.text === "unknown") return true;
  switch (value.primitive) {
    case "string":
      return typeof literal === "string";
    case "number":
      return typeof literal === "number";
    case "bigint":
      return typeof literal === "bigint";
    case "boolean":
      return typeof literal === "boolean";
    case null:
      return false;
    default:
      return assertExhaustive(value.primitive, "Unhandled primitive type");
  }
};

export const negate = (value: SymbolicValue): SymbolicValue =>
  value.kind === "UnaryExpression" && value.operator === "!"
    ? value.value
    : { kind: "UnaryExpression", operator: "!", value };

const getPrecedence = (value: SymbolicValue): number => {
  if (value.kind === "BinaryExpression") return BINARY_PRECEDENCE.get(value.operator) ?? 0;
  if (value.kind === "Conditional") return 0;
  return ATOMIC_PRECEDENCE;
};

const formatWithPrecedence = (value: SymbolicValue, minimumPrecedence: number): string => {
  const text = formatSymbolicValue(value);
  return getPrecedence(value) < minimumPrecedence ? `(${text})` : text;
};

export const formatSymbolicValue = (value: SymbolicValue): string => {
  switch (value.kind) {
    case "Primitive":
      return formatPrimitive(value.value);
    case "Binding":
      return formatPlace(value.binding, value.path);
    case "UnaryExpression":
      return `${value.operator}${formatWithPrecedence(value.value, ATOMIC_PRECEDENCE)}`;
    case "BinaryExpression": {
      const precedence = BINARY_PRECEDENCE.get(value.operator) ?? 0;
      return `${formatWithPrecedence(value.left, precedence)} ${value.operator} ${formatWithPrecedence(value.right, precedence + 1)}`;
    }
    case "Conditional": {
      const test =
        value.testKind === "nullish"
          ? `${formatWithPrecedence(value.test, 5)} != null`
          : formatWithPrecedence(value.test, 1);
      return `${test} ? ${formatSymbolicValue(value.consequent)} : ${formatSymbolicValue(value.alternate)}`;
    }
    case "ObjectExpression": {
      const entries = [
        ...value.spreads.map((spread) => `...${formatSymbolicValue(spread)}`),
        ...value.properties.map(
          (property) => `${property.key}: ${formatSymbolicValue(property.value)}`,
        ),
      ];
      return `{ ${entries.join(", ")} }`;
    }
    case "ArrayExpression":
      return `[${[...value.spreads.map((spread) => `...${formatSymbolicValue(spread)}`), ...value.elements.map(formatSymbolicValue)].join(", ")}]`;
    case "ArrayMap":
      return `${formatWithPrecedence(value.array, ATOMIC_PRECEDENCE)}.map(…)`;
    case "JsxExpression":
      return `<${value.tag.name} />`;
    case "JsxFragment":
      return "<></>";
    case "JSXText":
      return JSON.stringify(value.value);
    case "Function":
      return "function";
    case "Setter":
      return `set ${value.binding.name}`;
    case "Dispatch":
      return `dispatch ${value.binding.name}`;
    case "Props":
      return "props";
    case "HookResult":
      return `${value.name}()`;
    case "Global":
      return value.name;
    case "Unknown":
      return `Unknown(${value.reason})`;
    default:
      return assertExhaustive(value, "Unhandled symbolic value");
  }
};

export const formatNegated = (value: SymbolicValue): string => {
  if (value.kind === "UnaryExpression" && value.operator === "!")
    return formatSymbolicValue(value.value);
  if (value.kind === "BinaryExpression") {
    const negatedOperator = getNegatedOperator(value.operator);
    if (negatedOperator) return formatSymbolicValue({ ...value, operator: negatedOperator });
    return `!(${formatSymbolicValue(value)})`;
  }
  return value.kind === "Conditional"
    ? `!(${formatSymbolicValue(value)})`
    : `!${formatSymbolicValue(value)}`;
};
