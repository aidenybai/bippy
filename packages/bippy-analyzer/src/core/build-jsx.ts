import type { SourceLocation } from "../react-compiler/HIR/HIR";
import type { JsxProp, JsxSpreadProp, JsxTag, SymbolicValue } from "./types";
import { getComponentName } from "./symbolic-values";

const DYNAMIC_TAG_NAME = "Dynamic";

interface JsxElementParts {
  declaration: string | null;
  isContext: boolean;
  props: Array<JsxProp | JsxSpreadProp>;
  children: SymbolicValue[];
  loc: SourceLocation;
}

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
  const jsxTag: JsxTag =
    tag.kind === "Primitive" && typeof tag.value === "string"
      ? { kind: "BuiltinTag", name: tag.value }
      : tag.kind === "Global"
        ? {
            kind: "Component",
            name: getComponentName(tag),
            declaration: elementParts.declaration,
            isContext: elementParts.isContext,
          }
        : { kind: "DynamicTag", name: DYNAMIC_TAG_NAME };
  if (jsxTag.kind === "Component") renderedComponents.add(jsxTag.name);
  const renderPropChildren =
    jsxTag.kind === "BuiltinTag"
      ? []
      : elementParts.children.filter((child) => child.kind === "Function");
  const renderFunctions = tag.kind === "Function" ? [tag] : [];
  const props: Array<JsxProp | JsxSpreadProp> = [
    ...elementParts.props,
    ...renderPropChildren.map((value): JsxProp => ({
      kind: "JsxAttribute",
      name: "children",
      value,
      handlerId: null,
    })),
    ...renderFunctions.map((value): JsxProp => ({
      kind: "JsxAttribute",
      name: "render",
      value,
      handlerId: null,
    })),
  ];
  return {
    kind: "JsxExpression",
    tag: jsxTag,
    props,
    children: elementParts.children,
    loc: elementParts.loc,
  };
};
