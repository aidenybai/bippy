import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { JsxTag, SymbolicValue, JsxProp, JsxSpreadProp } from "../types";
import { assertExhaustive } from "../../react-compiler/Utils/utils";

type KeyPart = string | number | boolean | null | KeyPart[];

const getLocationPart = (loc: SourceLocation): KeyPart =>
  loc === GeneratedSource ? "generated" : [loc.start.index, loc.end.index];

const getTagPart = (tag: JsxTag): KeyPart =>
  tag.kind === "Component" ? [tag.kind, tag.name, tag.declaration] : [tag.kind, tag.name];

const internedIds = new Map<string, number>();

const keysByValue = new WeakMap<SymbolicValue, string>();

const getPropPart = (prop: JsxProp | JsxSpreadProp): KeyPart =>
  prop.kind === "JsxAttribute"
    ? [prop.name, getValueKey(prop.value)]
    : ["...", getValueKey(prop.value)];

const getKeyPart = (value: SymbolicValue): KeyPart => {
  switch (value.kind) {
    case "Primitive":
      return [value.kind, typeof value.value, String(value.value)];
    case "Binding":
      return [value.kind, value.binding.id, value.path];
    case "BinaryExpression":
      return [value.kind, value.operator, getValueKey(value.left), getValueKey(value.right)];
    case "UnaryExpression":
      return [value.kind, value.operator, getValueKey(value.value)];
    case "Conditional":
      return [
        value.kind,
        value.testKind,
        value.branch.file,
        getLocationPart(value.branch.loc),
        getValueKey(value.test),
        getValueKey(value.consequent),
        getValueKey(value.alternate),
      ];
    case "ObjectExpression":
      return [
        value.kind,
        value.properties.map((property) => [property.key, getValueKey(property.value)]),
        value.spreads.map(getValueKey),
      ];
    case "ArrayExpression":
      return [value.kind, value.elements.map(getValueKey), value.spreads.map(getValueKey)];
    case "ArrayMap":
      return [value.kind, getValueKey(value.array), getValueKey(value.item)];
    case "JsxExpression":
      return [
        value.kind,
        getTagPart(value.tag),
        value.props.map(getPropPart),
        value.children.map(getValueKey),
      ];
    case "JsxFragment":
      return [value.kind, value.children.map(getValueKey)];
    case "JSXText":
      return [value.kind, value.value];
    case "Function":
      return [value.kind, value.functionId];
    case "Setter":
    case "Dispatch":
      return [value.kind, value.binding.id];
    case "Props":
      return [value.kind];
    case "HookResult":
      return [
        value.kind,
        value.name,
        value.module,
        getLocationPart(value.loc),
        value.argumentValues.map(getValueKey),
      ];
    case "Global":
      return [value.kind, value.name, value.module];
    case "Unknown":
      return [value.kind, value.reason, getLocationPart(value.loc)];
    default:
      return assertExhaustive(value, "Unhandled symbolic value");
  }
};

export const getValueKey = (value: SymbolicValue): string => {
  const cachedKey = keysByValue.get(value);
  if (cachedKey !== undefined) return cachedKey;
  const structure = JSON.stringify(getKeyPart(value));
  const internedId = internedIds.get(structure) ?? internedIds.size;
  internedIds.set(structure, internedId);
  const valueKey = `#${internedId}`;
  keysByValue.set(value, valueKey);
  return valueKey;
};
