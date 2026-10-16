import type { SymbolicValue } from "../types";

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
      return value.argumentValues;
    default:
      return [];
  }
};

export const forEachSymbolicValue = (
  root: SymbolicValue,
  visit: (value: SymbolicValue) => void,
): void => {
  const visited = new WeakSet<SymbolicValue>();
  const walk = (value: SymbolicValue): void => {
    if (visited.has(value)) return;
    visited.add(value);
    visit(value);
    for (const child of getChildValues(value)) walk(child);
  };
  walk(root);
};
