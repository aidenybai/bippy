import type { JsxExpressionValue, SymbolicValue } from "../types.js";

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
