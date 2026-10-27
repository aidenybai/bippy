import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { SourceLocation } from "../react-compiler/HIR/HIR";
import { assertExhaustive } from "../react-compiler/Utils/utils";
import type {
  AbstractValue,
  BinaryExpressionValue,
  Binding,
  ConditionalValue,
  PrimitiveValue,
  SymbolicValue,
  UnknownOrigin,
} from "./types";
import { getNegatedOperator } from "./utils/get-negated-operator";
import { getValueKey } from "./utils/get-value-key";
import { isTreeLargerThan } from "./utils/is-tree-larger-than";

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

export const formatStateLabel = (stateIndex: number): string => `S${stateIndex + 1}`;

export const formatLine = (loc: SourceLocation): string =>
  loc === GeneratedSource ? "" : `L${loc.start.line}`;

export const formatPlace = (binding: Binding, path: readonly string[]): string =>
  [binding.name, ...path].join(".");

const formatPrimitive = (value: PrimitiveValue): string =>
  typeof value === "string" ? JSON.stringify(value) : String(value);

const formatEntry = (
  [key, entryValue]: [PrimitiveValue, PrimitiveValue],
  isMap: boolean,
): string =>
  isMap ? `${formatPrimitive(key)} => ${formatPrimitive(entryValue)}` : formatPrimitive(key);

export const formatAbstractValue = (value: AbstractValue): string => {
  if (value.kind === "Literal") return formatPrimitive(value.value);
  if (value.kind === "Type") return value.text;
  const isMap = value.collection === "Map";
  const entries = value.entries.map((entry) => formatEntry(entry, isMap));
  return `${value.collection} {${entries.join(", ")}}`;
};

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
  if (isTreeLargerThan(value, MAX_FORMATTED_NODES)) return ELIDED_TEXT;
  switch (value.kind) {
    case "Primitive":
      return formatPrimitive(value.value);
    case "Binding":
      return formatPlace(value.binding, value.path);
    case "UnaryExpression": {
      const resolvedPromise = value.operator === "!" ? getResolvedPromise(value.value) : null;
      if (resolvedPromise) return `${formatSymbolicValue(resolvedPromise)} resolves`;
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
    case "RegExp":
      return `/${value.pattern}/${value.flags}`;
    case "HookResult":
      return `${value.name}()`;
    case "Global":
      return value.name;
    case "Collection": {
      const source = value.source ? formatSymbolicValue(value.source) : "";
      const writes = value.writes.map((write) => {
        const call = `.${write.method}(${write.argumentValues.map(formatSymbolicValue).join(", ")})`;
        const guards = write.guards.map(formatSymbolicValue).join(" && ");
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
      return `${formatWithPrecedence(origin.callee, ATOMIC_PRECEDENCE)}(${origin.argumentValues.map(formatSymbolicValue).join(", ")})`;
    case "Settled":
      return origin.outcome === "resolved"
        ? `await ${formatWithPrecedence(origin.promise, ATOMIC_PRECEDENCE)}`
        : `${formatSymbolicValue(origin.promise)} rejects`;
    case "Value":
      return formatSymbolicValue(origin.value);
    default:
      return assertExhaustive(origin, "Unhandled unknown origin");
  }
};

const getResolvedPromise = (value: SymbolicValue): SymbolicValue | null =>
  value.kind === "Unknown" &&
  value.origin?.kind === "Settled" &&
  value.origin.outcome === "rejected"
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
    const negatedOperator = getNegatedOperator(value.operator);
    if (negatedOperator && isComplement(value))
      return formatSymbolicValue({ ...value, operator: negatedOperator });
    return `!(${formatSymbolicValue(value)})`;
  }
  return value.kind === "Conditional"
    ? `!(${formatSymbolicValue(value)})`
    : `!${formatSymbolicValue(value)}`;
};
