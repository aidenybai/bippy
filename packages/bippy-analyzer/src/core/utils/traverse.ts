import type { JsxExpressionValue, SymbolicValue } from "../types";

export const forEachRenderNode = (
  value: SymbolicValue,
  visit: (node: SymbolicValue) => void,
): void => {
  const visited = new WeakSet<SymbolicValue>();
  const walk = (node: SymbolicValue): void => {
    if (visited.has(node)) return;
    visited.add(node);
    visit(node);
    switch (node.kind) {
      case "JsxExpression":
      case "JsxFragment":
        node.children.forEach(walk);
        return;
      case "Conditional":
        walk(node.consequent);
        walk(node.alternate);
        return;
      case "ArrayMap":
        walk(node.item);
        return;
      default:
        return;
    }
  };
  walk(value);
};

export const forEachJsxElement = (
  value: SymbolicValue,
  visit: (element: JsxExpressionValue) => void,
): void => {
  const visited = new WeakSet<SymbolicValue>();
  const walk = (root: SymbolicValue): void =>
    forEachRenderNode(root, (node) => {
      if (node.kind !== "JsxExpression" || visited.has(node)) return;
      visited.add(node);
      visit(node);
      for (const prop of node.props) if (prop.kind === "JsxAttribute") walk(prop.value);
    });
  walk(value);
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
