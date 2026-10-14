import type { SourceLocation } from "../react-compiler/HIR/HIR";
import type { JsxProp, JsxSpreadProp, JsxTag, SymbolicValue } from "./types";

const DYNAMIC_TAG_NAME = "Dynamic";

interface JsxElementParts {
  declaration: string | null;
  isContext: boolean;
  reactExport: string | null;
  props: Array<JsxProp | JsxSpreadProp>;
  children: SymbolicValue[];
  loc: SourceLocation;
}

const getJsxTag = (tag: SymbolicValue, elementParts: JsxElementParts): JsxTag => {
  if (tag.kind === "Primitive" && typeof tag.value === "string")
    return { kind: "BuiltinTag", name: tag.value };
  if (tag.kind === "Global")
    return {
      kind: "Component",
      name: tag.name,
      declaration: elementParts.declaration,
      isContext: elementParts.isContext,
      reactExport: elementParts.reactExport,
    };
  return { kind: "DynamicTag", name: DYNAMIC_TAG_NAME };
};

const createFunctionProp = (name: string, value: SymbolicValue): JsxProp => ({
  kind: "JsxAttribute",
  name,
  value,
  handlerId: null,
});

const getRenderFunctionProps = (
  tag: SymbolicValue,
  jsxTag: JsxTag,
  children: SymbolicValue[],
): JsxProp[] => {
  const renderPropChildren =
    jsxTag.kind === "BuiltinTag" ? [] : children.filter((child) => child.kind === "Function");
  const renderFunctions = tag.kind === "Function" ? [tag] : [];
  return [
    ...renderPropChildren.map((value) => createFunctionProp("children", value)),
    ...renderFunctions.map((value) => createFunctionProp("render", value)),
  ];
};

export const buildJsx = (
  tag: SymbolicValue,
  elementParts: JsxElementParts,
  renderedComponents: Set<string>,
): SymbolicValue => {
  if (tag.kind === "Conditional")
    return {
      ...tag,
      consequent: buildJsx(tag.consequent, elementParts, renderedComponents),
      alternate: buildJsx(tag.alternate, elementParts, renderedComponents),
    };
  const jsxTag = getJsxTag(tag, elementParts);
  if (jsxTag.kind === "Component") renderedComponents.add(jsxTag.name);
  return {
    kind: "JsxExpression",
    tag: jsxTag,
    props: [...elementParts.props, ...getRenderFunctionProps(tag, jsxTag, elementParts.children)],
    children: elementParts.children,
    loc: elementParts.loc,
  };
};
