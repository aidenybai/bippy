import { GeneratedSource } from "../compiler/hir/hir.js";
import type { SourceLocation } from "../compiler/hir/hir.js";
import { assertExhaustive } from "../compiler/utils/utils.js";
import type {
  AbstractValue,
  Binding,
  BindingValue,
  ConditionalValue,
  JsxExpressionValue,
  PrimitiveValue,
  SymbolicValue,
  TestKind,
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

export const parsePlaceKey = (placeKey: string): { bindingId: number; path: string[] } => {
  const [bindingId = "", ...path] = placeKey.split(".");
  return { bindingId: Number(bindingId), path };
};

export const isPlacePrefix = (prefix: string, placeKey: string): boolean =>
  placeKey === prefix || placeKey.startsWith(`${prefix}.`);

export const isWholeBinding = (value: SymbolicValue, binding: Binding): boolean =>
  value.kind === "Binding" && value.binding.id === binding.id && value.path.length === 0;

export const isStateBinding = (binding: Binding): boolean =>
  binding.kind === "state" || binding.kind === "reducer";

/**
 * A custom hook's result or a context value: data the component reads but doesn't own.
 */
export const isExternalSource = (binding: Binding): boolean =>
  binding.kind === "hook" || binding.kind === "context";

export const formatLine = (loc: SourceLocation): string =>
  loc === GeneratedSource ? "" : `L${loc.line}`;

export const formatPlace = (binding: Binding, path: readonly string[]): string =>
  [binding.name, ...path].join(".");

const formatPrimitive = (value: PrimitiveValue): string =>
  typeof value === "string" ? JSON.stringify(value) : String(value);

export const formatAbstractValue = (value: AbstractValue): string =>
  value.kind === "Literal" ? formatPrimitive(value.value) : value.text;

export const getTruthiness = (value: AbstractValue): Truthiness => {
  if (value.kind === "Literal") return value.value ? "truthy" : "falsy";
  if (value.text === "void") return "falsy";
  return value.primitive === null ? "truthy" : "either";
};

export const isNullish = (value: PrimitiveValue): boolean => value === null || value === undefined;

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

/**
 * The test a decision checks, as an expression: the value itself, or `value != null` for a
 * nullish test.
 */
export const getTestExpression = ({
  test,
  testKind,
}: {
  test: SymbolicValue;
  testKind: TestKind;
}): SymbolicValue =>
  testKind === "nullish"
    ? {
        kind: "BinaryExpression",
        operator: "!=",
        left: test,
        right: { kind: "Primitive", value: null },
      }
    : test;

/**
 * Whether a value is truthy no matter what the bindings hold: primitives by their value,
 * JSX, functions, objects and arrays always. `null` when it depends.
 */
export const getKnownTruthiness = (value: SymbolicValue): boolean | null => {
  switch (value.kind) {
    case "Primitive":
      return Boolean(value.value);
    case "JsxExpression":
    case "JsxFragment":
    case "Function":
    case "ObjectExpression":
    case "ArrayExpression":
      return true;
    default:
      return null;
  }
};

/**
 * Whether React renders nothing for this value: `null`, `undefined`, or a boolean.
 */
export const isRenderingNothing = (value: SymbolicValue): boolean =>
  value.kind === "Primitive" &&
  (value.value === null || value.value === undefined || typeof value.value === "boolean");

/**
 * Whether the alternate of a conditional renders nothing, as in `cond && <A />`, where it is
 * either an empty value or the test itself.
 */
export const isRenderingNothingWhenFalse = (conditional: ConditionalValue): boolean =>
  isRenderingNothing(conditional.alternate) ||
  formatSymbolicValue(conditional.alternate) === formatSymbolicValue(conditional.test);

/**
 * Calls `visit` on every node of a render tree, parents before children and consequents
 * before alternates.
 */
export const forEachRenderNode = (
  value: SymbolicValue,
  visit: (node: SymbolicValue) => void,
): void => {
  visit(value);
  switch (value.kind) {
    case "JsxExpression":
    case "JsxFragment":
      for (const child of value.children) forEachRenderNode(child, visit);
      return;
    case "Conditional":
      forEachRenderNode(value.consequent, visit);
      forEachRenderNode(value.alternate, visit);
      return;
    case "ArrayMap":
      forEachRenderNode(value.item, visit);
      return;
    default:
      return;
  }
};

export const forEachJsxElement = (
  value: SymbolicValue,
  visit: (element: JsxExpressionValue) => void,
): void =>
  forEachRenderNode(value, (node) => {
    if (node.kind === "JsxExpression") visit(node);
  });

const getPrecedence = (value: SymbolicValue): number => {
  if (value.kind === "BinaryExpression") return BINARY_PRECEDENCE.get(value.operator) ?? 0;
  if (value.kind === "Conditional") return formatOptionalChain(value) ? ATOMIC_PRECEDENCE : 0;
  return ATOMIC_PRECEDENCE;
};

const formatWithPrecedence = (value: SymbolicValue, minimumPrecedence: number): string => {
  const text = formatSymbolicValue(value);
  return getPrecedence(value) < minimumPrecedence ? `(${text})` : text;
};

const getChildValues = (value: SymbolicValue): SymbolicValue[] => {
  switch (value.kind) {
    case "BinaryExpression":
      return [value.left, value.right];
    case "UnaryExpression":
      return [value.value];
    case "Conditional":
      return [value.test, value.consequent, value.alternate];
    case "ObjectExpression":
      return [...value.properties.map((property) => property.value), ...value.spreads];
    case "ArrayExpression":
      return [...value.elements, ...value.spreads];
    case "ArrayMap":
      return [value.array, value.item];
    case "JsxExpression":
      return [...value.props.map((prop) => prop.value), ...value.children];
    case "JsxFragment":
      return value.children;
    case "HookResult":
      return value.args;
    default:
      return [];
  }
};

/**
 * Visits every part of a value once, including subtrees it shares with itself.
 */
export const forEachSymbolicValue = (
  root: SymbolicValue,
  visit: (value: SymbolicValue) => void,
): void => {
  const seen = new Set<SymbolicValue>();
  const walk = (value: SymbolicValue): void => {
    if (seen.has(value)) return;
    seen.add(value);
    visit(value);
    for (const child of getChildValues(value)) walk(child);
  };
  walk(root);
};

/**
 * Rebuilds a value bottom-up, letting `replace` swap any part of it.
 */
export const mapSymbolicValue = (
  value: SymbolicValue,
  replace: (value: SymbolicValue) => SymbolicValue,
): SymbolicValue => {
  const map = (child: SymbolicValue): SymbolicValue => mapSymbolicValue(child, replace);
  switch (value.kind) {
    case "BinaryExpression":
      return replace({ ...value, left: map(value.left), right: map(value.right) });
    case "UnaryExpression":
      return replace({ ...value, value: map(value.value) });
    case "Conditional":
      return replace({
        ...value,
        test: map(value.test),
        consequent: map(value.consequent),
        alternate: map(value.alternate),
      });
    case "ObjectExpression":
      return replace({
        ...value,
        properties: value.properties.map((property) => ({
          ...property,
          value: map(property.value),
        })),
        spreads: value.spreads.map(map),
      });
    case "ArrayExpression":
      return replace({
        ...value,
        elements: value.elements.map(map),
        spreads: value.spreads.map(map),
      });
    default:
      return replace(value);
  }
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
