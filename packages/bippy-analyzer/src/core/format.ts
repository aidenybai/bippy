import { GeneratedSource } from "../react-compiler/HIR/HIR.js";
import type { SourceLocation } from "../react-compiler/HIR/HIR.js";
import { assertExhaustive } from "../react-compiler/Utils/utils.js";
import type {
  AbstractValue,
  Binding,
  BindingValue,
  ConditionalValue,
  PrimitiveValue,
  SymbolicValue,
} from "./types.js";
import { getNegatedOperator } from "./utils/truthiness.js";

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

export const formatLine = (loc: SourceLocation): string =>
  loc === GeneratedSource ? "" : `L${loc.start.line}`;

export const formatPlace = (binding: Binding, path: readonly string[]): string =>
  [binding.name, ...path].join(".");

const formatPrimitive = (value: PrimitiveValue): string =>
  typeof value === "string" ? JSON.stringify(value) : String(value);

export const formatAbstractValue = (value: AbstractValue): string =>
  value.kind === "Literal" ? formatPrimitive(value.value) : value.text;

/**
 * Creates a printer of symbolic values that prints bindings with `formatBinding`.
 */
const createFormatter = (
  formatBinding: (value: BindingValue) => string,
): ((value: SymbolicValue) => string) => {
  const getPrecedence = (value: SymbolicValue): number => {
    if (value.kind === "BinaryExpression") return BINARY_PRECEDENCE.get(value.operator) ?? 0;
    if (value.kind === "Conditional") return formatOptionalChain(value) ? ATOMIC_PRECEDENCE : 0;
    return ATOMIC_PRECEDENCE;
  };

  const formatWithPrecedence = (value: SymbolicValue, minimumPrecedence: number): string => {
    const text = formatValue(value);
    return getPrecedence(value) < minimumPrecedence ? `(${text})` : text;
  };

  /**
   * Prints `x != null ? x.y : undefined`, how `x?.y` lowers, as the optional chain.
   */
  const formatOptionalChain = (value: ConditionalValue): string | null => {
    if (
      value.testKind !== "nullish" ||
      value.alternate.kind !== "Primitive" ||
      value.alternate.value !== undefined
    )
      return null;
    const test = formatWithPrecedence(value.test, ATOMIC_PRECEDENCE);
    const plainTest = test.replaceAll("?.", ".");
    const consequent = formatValue(value.consequent).replaceAll("?.", ".");
    const rest = consequent.slice(plainTest.length);
    return consequent.startsWith(plainTest) && /^[.[(]/.test(rest)
      ? `${test}?${rest.startsWith(".") ? "" : "."}${rest}`
      : null;
  };

  const formatValue = (value: SymbolicValue): string => {
    switch (value.kind) {
      case "Primitive":
        return formatPrimitive(value.value);
      case "Binding":
        return formatBinding(value);
      case "UnaryExpression":
        return `${value.operator}${formatWithPrecedence(value.value, ATOMIC_PRECEDENCE)}`;
      case "BinaryExpression": {
        const precedence = BINARY_PRECEDENCE.get(value.operator) ?? 0;
        return `${formatWithPrecedence(value.left, precedence)} ${value.operator} ${formatWithPrecedence(value.right, precedence + 1)}`;
      }
      case "Conditional": {
        const optionalChain = formatOptionalChain(value);
        if (optionalChain) return optionalChain;
        const test =
          value.testKind === "nullish"
            ? `${formatWithPrecedence(value.test, 5)} != null`
            : formatWithPrecedence(value.test, 1);
        return `${test} ? ${formatValue(value.consequent)} : ${formatValue(value.alternate)}`;
      }
      case "ObjectExpression": {
        const entries = [
          ...value.spreads.map((spread) => `...${formatValue(spread)}`),
          ...value.properties.map((property) => `${property.key}: ${formatValue(property.value)}`),
        ];
        return `{ ${entries.join(", ")} }`;
      }
      case "ArrayExpression":
        return `[${[...value.spreads.map((spread) => `...${formatValue(spread)}`), ...value.elements.map(formatSymbolicValue)].join(", ")}]`;
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

  return formatValue;
};

export const formatSymbolicValue = createFormatter(({ binding, path }) =>
  formatPlace(binding, path),
);

/**
 * Prints a value with each binding's id in place of its name, so two bindings that print
 * the same, like the results of two calls to one helper, stay apart when values are matched.
 */
export const formatValueKey = createFormatter(({ binding, path }) =>
  [`#${binding.id}`, ...path].join("."),
);

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
