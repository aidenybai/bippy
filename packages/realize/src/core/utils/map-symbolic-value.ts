import type { SymbolicValue } from "../types";
import { assertExhaustive } from "../../react-compiler/Utils/utils";

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
    case "ArrayMap":
      return { ...value, array: mapChild(value.array), item: mapChild(value.item) };
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
    case "Primitive":
    case "Binding":
    case "JSXText":
    case "Function":
    case "Setter":
    case "Dispatch":
    case "Props":
    case "RegExp":
    case "Global":
    case "Unknown":
    case "JsxExpression":
    case "JsxFragment":
    case "HookResult":
    case "Bound":
      return value;
    default:
      return assertExhaustive(value, "Unhandled symbolic value");
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
