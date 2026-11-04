import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import { assertExhaustive } from "../../react-compiler/Utils/utils";
import type {
  AbstractValue,
  BinaryExpressionValue,
  Binding,
  ConditionalValue,
  PrimitiveValue,
  SymbolicValue,
  UnknownOrigin,
} from "../types";
import { NEGATED, isComparison } from "./comparison";
import { getChildValues } from "./for-each-symbolic-value";
import { getValueKey } from "./get-value-key";
import { getOriginValues } from "./symbolic-values";

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
const MAX_FORMATTED_NODES = 200;
const ELIDED_TEXT = "…";

export const CONDITION_SEPARATOR = " ∧ ";
export const UNCONDITIONAL_LABEL = "always";

export const formatLine = (loc: SourceLocation): string =>
  loc === GeneratedSource ? "" : `L${loc.start.line}`;

export const formatPlace = (binding: Binding, path: readonly string[]): string =>
  [binding.name, ...path].join(".");

const formatPrimitive = (value: PrimitiveValue): string => {
  if (typeof value === "string") return JSON.stringify(value);
  return Object.is(value, -0) ? "-0" : String(value);
};

export const formatAbstractValue = (value: AbstractValue): string =>
  value.kind === "Literal" ? formatPrimitive(value.value) : value.text;

const getLogicalOperator = (value: ConditionalValue): "||" | "&&" | "??" | null => {
  const testKey = getValueKey(value.test);
  if (getValueKey(value.consequent) === testKey) return value.testKind === "nullish" ? "??" : "||";
  if (value.testKind === "truthy" && getValueKey(value.alternate) === testKey) return "&&";
  return null;
};

interface Formatted {
  text: string;
  precedence: number;
}

const atomic = (text: string): Formatted => ({ text, precedence: ATOMIC_PRECEDENCE });

const formatText = (value: SymbolicValue): string => formatValue(value).text;

const formatWithPrecedence = (value: SymbolicValue, minimumPrecedence: number): string => {
  const { text, precedence } = formatValue(value);
  return precedence < minimumPrecedence ? `(${text})` : text;
};

const formatBinary = (left: SymbolicValue, operator: string, right: SymbolicValue): Formatted => {
  const precedence = BINARY_PRECEDENCE.get(operator) ?? 0;
  return {
    text: `${formatWithPrecedence(left, precedence)} ${operator} ${formatWithPrecedence(right, precedence + 1)}`,
    precedence,
  };
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
  const consequent = formatText(value.consequent).replaceAll("?.", ".");
  const rest = consequent.slice(plainTest.length);
  return consequent.startsWith(plainTest) && /^[.[(]/.test(rest)
    ? `${test}?${rest.startsWith(".") ? "" : "."}${rest}`
    : null;
};

const formatConditional = (value: ConditionalValue): Formatted => {
  const optionalChain = formatOptionalChain(value);
  if (optionalChain) return atomic(optionalChain);
  const logicalOperator = getLogicalOperator(value);
  if (logicalOperator)
    return formatBinary(
      value.test,
      logicalOperator,
      logicalOperator === "&&" ? value.consequent : value.alternate,
    );
  const test =
    value.testKind === "nullish"
      ? `${formatWithPrecedence(value.test, COMPARED_OPERAND_PRECEDENCE)} != null`
      : formatWithPrecedence(value.test, TERNARY_TEST_PRECEDENCE);
  return {
    text: `${test} ? ${formatText(value.consequent)} : ${formatText(value.alternate)}`,
    precedence: 0,
  };
};

const formatAtomic = (
  value: Exclude<SymbolicValue, { kind: "BinaryExpression" | "Conditional" }>,
): string => {
  switch (value.kind) {
    case "Primitive":
      return formatPrimitive(value.value);
    case "Binding":
      return formatPlace(value.binding, value.path);
    case "UnaryExpression": {
      const resolvedPromise = value.operator === "!" ? getResolvedPromise(value.value) : null;
      if (resolvedPromise) return `${formatText(resolvedPromise)} resolves`;
      const separator = WORD_OPERATOR_PATTERN.test(value.operator) ? " " : "";
      return `${value.operator}${separator}${formatWithPrecedence(value.value, ATOMIC_PRECEDENCE)}`;
    }
    case "ObjectExpression": {
      const entries = [
        ...value.spreads.map((spread) => `...${formatText(spread)}`),
        ...value.properties.map((property) => `${property.key}: ${formatText(property.value)}`),
      ];
      return `{ ${entries.join(", ")} }`;
    }
    case "ArrayExpression": {
      const entries = [
        ...value.spreads.map((spread) => `...${formatText(spread)}`),
        ...value.elements.map(formatText),
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
    case "RegExp":
      return `/${value.pattern}/${value.flags}`;
    case "HookResult":
      return `${value.name}()`;
    case "Global":
      return value.name;
    case "Collection": {
      const source = value.source ? formatText(value.source) : "";
      const writes = value.writes.map((write) => {
        const call = `.${write.method}(${write.argumentValues.map(formatText).join(", ")})`;
        const guards = write.guards.map(formatText).join(" && ");
        return write.guards.length > 0 ? ` (${call} if ${guards})` : call;
      });
      return `new ${value.collection}(${source})${writes.join("")}`;
    }
    case "Unknown": {
      const origin = value.origin ? formatOrigin(value.origin) : null;
      return origin !== null && origin.length <= MAX_ORIGIN_LENGTH
        ? origin
        : `Unknown(${value.reason})`;
    }
    default:
      return assertExhaustive(value, "Unhandled symbolic value");
  }
};

const formatValue = (value: SymbolicValue): Formatted => {
  if (value.kind === "BinaryExpression")
    return formatBinary(value.left, value.operator, value.right);
  return value.kind === "Conditional" ? formatConditional(value) : atomic(formatAtomic(value));
};

const isTooLargeToFormat = (root: SymbolicValue): boolean => {
  const pending = [root];
  let count = 0;
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    count++;
    if (count > MAX_FORMATTED_NODES) return true;
    pending.push(...getChildValues(value));
    if (value.kind === "Unknown" && value.origin) pending.push(...getOriginValues(value.origin));
  }
  return false;
};

export const formatSymbolicValue = (value: SymbolicValue): string =>
  isTooLargeToFormat(value) ? ELIDED_TEXT : formatText(value);

const MAX_ORIGIN_LENGTH = 80;

const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;

const formatMember = (property: string): string => {
  if (IDENTIFIER_PATTERN.test(property)) return `.${property}`;
  return /^\d+$/.test(property) ? `[${property}]` : `[${JSON.stringify(property)}]`;
};

const formatOrigin = (origin: UnknownOrigin): string => {
  switch (origin.kind) {
    case "Name":
      return origin.name;
    case "Member":
      return `${formatWithPrecedence(origin.object, ATOMIC_PRECEDENCE)}${formatMember(origin.property)}`;
    case "Call":
      return `${formatWithPrecedence(origin.callee, ATOMIC_PRECEDENCE)}(${origin.argumentValues.map(formatText).join(", ")})`;
    case "Settled":
      return origin.settlement === "fulfilled"
        ? `await ${formatWithPrecedence(origin.promise, ATOMIC_PRECEDENCE)}`
        : `${formatText(origin.promise)} rejects`;
    case "Value":
      return formatText(origin.value);
    default:
      return assertExhaustive(origin, "Unhandled unknown origin");
  }
};

const getResolvedPromise = (value: SymbolicValue): SymbolicValue | null =>
  value.kind === "Unknown" &&
  value.origin?.kind === "Settled" &&
  value.origin.settlement === "rejected"
    ? value.origin.promise
    : null;

export const formatNegated = (
  value: SymbolicValue,
  isComplement: (comparison: BinaryExpressionValue) => boolean = () => true,
): string => {
  if (value.kind === "UnaryExpression" && value.operator === "!")
    return formatSymbolicValue(value.value);
  const resolvedPromise = getResolvedPromise(value);
  if (resolvedPromise) return `${formatSymbolicValue(resolvedPromise)} resolves`;
  if (value.kind === "BinaryExpression") {
    if (isComparison(value.operator) && isComplement(value))
      return formatSymbolicValue({ ...value, operator: NEGATED[value.operator] });
    return `!(${formatSymbolicValue(value)})`;
  }
  return value.kind === "Conditional"
    ? `!(${formatSymbolicValue(value)})`
    : `!${formatSymbolicValue(value)}`;
};
