import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { SourceLocation } from "../react-compiler/HIR/HIR";
import { assertExhaustive } from "../react-compiler/Utils/utils";
import type {
  AbstractValue,
  Binding,
  ConditionalValue,
  PrimitiveValue,
  SymbolicValue,
} from "./types";
import { getNegatedOperator } from "./utils/get-negated-operator";
import { getValueKey } from "./utils/get-value-key";

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
const COMPARED_OPERAND_PRECEDENCE = 5;
const TERNARY_TEST_PRECEDENCE = 1;
const WORD_OPERATOR_PATTERN = /^[a-z]/;

export const CONDITION_SEPARATOR = " ∧ ";
export const UNCONDITIONAL_LABEL = "always";

export const formatStateLabel = (stateIndex: number): string => `S${stateIndex + 1}`;

export const formatLine = (loc: SourceLocation): string =>
  loc === GeneratedSource ? "" : `L${loc.start.line}`;

export const formatPlace = (binding: Binding, path: readonly string[]): string =>
  [binding.name, ...path].join(".");

const formatPrimitive = (value: PrimitiveValue): string =>
  typeof value === "string" ? JSON.stringify(value) : String(value);

export const formatAbstractValue = (value: AbstractValue): string =>
  value.kind === "Literal" ? formatPrimitive(value.value) : value.text;

const getLogicalOperator = (value: ConditionalValue): "||" | "&&" | "??" | null => {
  const testKey = getValueKey(value.test);
  if (getValueKey(value.consequent) === testKey) return value.testKind === "nullish" ? "??" : "||";
  if (value.testKind === "truthy" && getValueKey(value.alternate) === testKey) return "&&";
  return null;
};

const getPrecedence = (value: SymbolicValue): number => {
  if (value.kind === "BinaryExpression") return BINARY_PRECEDENCE.get(value.operator) ?? 0;
  if (value.kind !== "Conditional") return ATOMIC_PRECEDENCE;
  if (formatOptionalChain(value)) return ATOMIC_PRECEDENCE;
  const logicalOperator = getLogicalOperator(value);
  return logicalOperator ? (BINARY_PRECEDENCE.get(logicalOperator) ?? 0) : 0;
};

const formatLogical = (value: ConditionalValue, operator: "||" | "&&" | "??"): string => {
  const precedence = BINARY_PRECEDENCE.get(operator) ?? 0;
  const right = operator === "&&" ? value.consequent : value.alternate;
  return `${formatWithPrecedence(value.test, precedence)} ${operator} ${formatWithPrecedence(right, precedence + 1)}`;
};

const formatWithPrecedence = (value: SymbolicValue, minimumPrecedence: number): string => {
  const text = formatSymbolicValue(value);
  return getPrecedence(value) < minimumPrecedence ? `(${text})` : text;
};

const formatOptionalChain = (value: ConditionalValue): string | null => {
  if (
    value.testKind !== "nullish" ||
    value.alternate.kind !== "Primitive" ||
    value.alternate.value !== undefined
  )
    return null;
  const test = formatWithPrecedence(value.test, ATOMIC_PRECEDENCE);
  const plainTest = test.replaceAll("?.", ".");
  const consequent = formatSymbolicValue(value.consequent).replaceAll("?.", ".");
  const rest = consequent.slice(plainTest.length);
  return consequent.startsWith(plainTest) && /^[.[(]/.test(rest)
    ? `${test}?${rest.startsWith(".") ? "" : "."}${rest}`
    : null;
};

export const formatSymbolicValue = (value: SymbolicValue): string => {
  switch (value.kind) {
    case "Primitive":
      return formatPrimitive(value.value);
    case "Binding":
      return formatPlace(value.binding, value.path);
    case "UnaryExpression": {
      const separator = WORD_OPERATOR_PATTERN.test(value.operator) ? " " : "";
      return `${value.operator}${separator}${formatWithPrecedence(value.value, ATOMIC_PRECEDENCE)}`;
    }
    case "BinaryExpression": {
      const precedence = BINARY_PRECEDENCE.get(value.operator) ?? 0;
      const left = formatWithPrecedence(value.left, precedence);
      const right = formatWithPrecedence(value.right, precedence + 1);
      return `${left} ${value.operator} ${right}`;
    }
    case "Conditional": {
      const optionalChain = formatOptionalChain(value);
      if (optionalChain) return optionalChain;
      const logicalOperator = getLogicalOperator(value);
      if (logicalOperator) return formatLogical(value, logicalOperator);
      const test =
        value.testKind === "nullish"
          ? `${formatWithPrecedence(value.test, COMPARED_OPERAND_PRECEDENCE)} != null`
          : formatWithPrecedence(value.test, TERNARY_TEST_PRECEDENCE);
      const consequent = formatSymbolicValue(value.consequent);
      const alternate = formatSymbolicValue(value.alternate);
      return `${test} ? ${consequent} : ${alternate}`;
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
    case "ArrayExpression": {
      const entries = [
        ...value.spreads.map((spread) => `...${formatSymbolicValue(spread)}`),
        ...value.elements.map(formatSymbolicValue),
      ];
      return `[${entries.join(", ")}]`;
    }
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
    case "Bound":
      return `${formatWithPrecedence(value.callee, ATOMIC_PRECEDENCE)}.bind(…)`;
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
