import type { SymbolicValue } from "../types";

export const mapSymbolicValue = (
  value: SymbolicValue,
  replace: (value: SymbolicValue) => SymbolicValue,
): SymbolicValue => {
  const mapChild = (child: SymbolicValue): SymbolicValue => mapSymbolicValue(child, replace);
  switch (value.kind) {
    case "BinaryExpression":
      return replace({ ...value, left: mapChild(value.left), right: mapChild(value.right) });
    case "UnaryExpression":
      return replace({ ...value, value: mapChild(value.value) });
    case "Conditional":
      return replace({
        ...value,
        test: mapChild(value.test),
        consequent: mapChild(value.consequent),
        alternate: mapChild(value.alternate),
      });
    case "ObjectExpression":
      return replace({
        ...value,
        properties: value.properties.map((property) => ({
          ...property,
          value: mapChild(property.value),
        })),
        spreads: value.spreads.map(mapChild),
      });
    case "ArrayExpression":
      return replace({
        ...value,
        elements: value.elements.map(mapChild),
        spreads: value.spreads.map(mapChild),
      });
    default:
      return replace(value);
  }
};
