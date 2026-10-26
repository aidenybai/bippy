import type { SourceLocation } from "../react-compiler/HIR/HIR";
import type { FunctionValue, JsxProp, JsxSpreadProp, JsxTag, SymbolicValue } from "./types";

export const DYNAMIC_TAG_NAME = "Dynamic";

export const LOCAL_RENDER_PROP = "render";

interface JsxElementParts {
  declaration: string | null;
  isContext: boolean;
  reactExport: string | null;
  props: Array<JsxProp | JsxSpreadProp>;
  children: SymbolicValue[];
  loc: SourceLocation;
  file: string;
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

const createFunctionProp = (name: string, value: FunctionValue, file: string): JsxProp => ({
  kind: "JsxAttribute",
  name,
  value,
  handlerId: null,
  loc: value.loc,
  file,
});

const getRenderFunctionProps = (
  tag: SymbolicValue,
  jsxTag: JsxTag,
  elementParts: JsxElementParts,
): JsxProp[] => {
  const renderPropChildren =
    jsxTag.kind === "BuiltinTag"
      ? []
      : elementParts.children.filter((child): child is FunctionValue => child.kind === "Function");
  const renderFunctions = tag.kind === "Function" ? [tag] : [];
  return [
    ...renderPropChildren.map((value) => createFunctionProp("children", value, elementParts.file)),
    ...renderFunctions.map((value) =>
      createFunctionProp(LOCAL_RENDER_PROP, value, elementParts.file),
    ),
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
    props: [...elementParts.props, ...getRenderFunctionProps(tag, jsxTag, elementParts)],
    children: elementParts.children,
    loc: elementParts.loc,
  };
};
