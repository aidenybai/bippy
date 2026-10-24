import type { SymbolicValue } from "../types";

const mapChildren = (
  value: SymbolicValue,
  mapChild: (child: SymbolicValue) => SymbolicValue,
): SymbolicValue => {
  switch (value.kind) {
    case "BinaryExpression":
      return { ...value, left: mapChild(value.left), right: mapChild(value.right) };
    case "UnaryExpression":
      return { ...value, value: mapChild(value.value) };
    case "Conditional":
      return {
        ...value,
        test: mapChild(value.test),
        consequent: mapChild(value.consequent),
        alternate: mapChild(value.alternate),
      };
    case "ObjectExpression":
      return {
        ...value,
        properties: value.properties.map((property) => ({
          ...property,
          value: mapChild(property.value),
        })),
        spreads: value.spreads.map(mapChild),
      };
    case "ArrayExpression":
      return {
        ...value,
        elements: value.elements.map(mapChild),
        spreads: value.spreads.map(mapChild),
      };
    case "Collection":
      return {
        ...value,
        source: value.source && mapChild(value.source),
        writes: value.writes.map((write) => ({
          ...write,
          argumentValues: write.argumentValues.map(mapChild),
          guards: write.guards.map(mapChild),
        })),
      };
    default:
      return value;
  }
};

export const mapSymbolicValue = (
  root: SymbolicValue,
  replace: (value: SymbolicValue) => SymbolicValue,
): SymbolicValue => {
  const mappedValues = new Map<SymbolicValue, SymbolicValue>();
  const mapValue = (value: SymbolicValue): SymbolicValue => {
    const cachedValue = mappedValues.get(value);
    if (cachedValue) return cachedValue;
    const mappedValue = replace(mapChildren(value, mapValue));
    mappedValues.set(value, mappedValue);
    return mappedValue;
  };
  return mapValue(root);
};
