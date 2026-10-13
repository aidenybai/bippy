import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import { assertExhaustive } from "../../react-compiler/Utils/utils";
import type { JsxProp, JsxSpreadProp, JsxTag, SymbolicValue } from "../types";

type KeyPart = string | number | boolean | null | KeyPart[];

const getLocationPart = (loc: SourceLocation): KeyPart =>
  loc === GeneratedSource ? "generated" : [loc.start.index, loc.end.index];

const getTagPart = (tag: JsxTag): KeyPart =>
  tag.kind === "Component" ? [tag.kind, tag.name, tag.declaration] : [tag.kind, tag.name];

const getPropPart = (prop: JsxProp | JsxSpreadProp): KeyPart =>
  prop.kind === "JsxAttribute"
    ? [prop.name, getKeyPart(prop.value)]
    : ["...", getKeyPart(prop.value)];

const getKeyPart = (value: SymbolicValue): KeyPart => {
  switch (value.kind) {
    case "Primitive":
      return [value.kind, typeof value.value, String(value.value)];
    case "Binding":
      return [value.kind, value.binding.id, value.path];
    case "BinaryExpression":
      return [value.kind, value.operator, getKeyPart(value.left), getKeyPart(value.right)];
    case "UnaryExpression":
      return [value.kind, value.operator, getKeyPart(value.value)];
    case "Conditional":
      return [
        value.kind,
        value.testKind,
        value.branch.file,
        getLocationPart(value.branch.loc),
        getKeyPart(value.test),
        getKeyPart(value.consequent),
        getKeyPart(value.alternate),
      ];
    case "ObjectExpression":
      return [
        value.kind,
        value.properties.map((property) => [property.key, getKeyPart(property.value)]),
        value.spreads.map(getKeyPart),
      ];
    case "ArrayExpression":
      return [value.kind, value.elements.map(getKeyPart), value.spreads.map(getKeyPart)];
    case "ArrayMap":
      return [value.kind, getKeyPart(value.array), getKeyPart(value.item)];
    case "JsxExpression":
      return [
        value.kind,
        getTagPart(value.tag),
        value.props.map(getPropPart),
        value.children.map(getKeyPart),
      ];
    case "JsxFragment":
      return [value.kind, value.children.map(getKeyPart)];
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
        value.args.map(getKeyPart),
      ];
    case "Global":
      return [value.kind, value.name, value.module];
    case "Unknown":
      return [value.kind, value.reason, getLocationPart(value.loc)];
    default:
      return assertExhaustive(value, "Unhandled symbolic value");
  }
};

export const getValueKey = (value: SymbolicValue): string => JSON.stringify(getKeyPart(value));
