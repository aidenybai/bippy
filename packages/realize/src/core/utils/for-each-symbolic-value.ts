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
    case "Bound":
      return [value.callee, ...value.argumentValues];
    case "Collection":
      return [
        ...(value.source ? [value.source] : []),
        ...value.writes.flatMap((write) => [...write.argumentValues, ...write.guards]),
      ];
    default:
      return [];
  }
};

export const forEachSymbolicValue = (
  root: SymbolicValue,
  visit: (value: SymbolicValue) => void,
): void => {
  const visited = new WeakSet<SymbolicValue>();
  const pending = [root];
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    if (visited.has(value)) continue;
    visited.add(value);
    visit(value);
    pending.push(...getChildValues(value).toReversed());
  }
};
