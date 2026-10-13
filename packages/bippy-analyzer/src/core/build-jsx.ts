import type { SourceLocation } from "../react-compiler/HIR/HIR";
import type { JsxProp, JsxSpreadProp, JsxTag, SymbolicValue } from "./types";
import { getComponentName } from "./symbolic-values";

const DYNAMIC_TAG_NAME = "Dynamic";

export interface JsxElementParts {
  declaration: string | null;
  isContext: boolean;
  props: Array<JsxProp | JsxSpreadProp>;
  children: SymbolicValue[];
  loc: SourceLocation;
}

/** Builds the element a tag renders, one per tag a conditional tag can be. */
export const buildJsx = (
  tag: SymbolicValue,
  parts: JsxElementParts,
  renderedComponents: Set<string>,
): SymbolicValue => {
  if (tag.kind === "Conditional")
    return {
      ...tag,
      consequent: buildJsx(tag.consequent, parts, renderedComponents),
      alternate: buildJsx(tag.alternate, parts, renderedComponents),
    };
  const jsxTag: JsxTag =
    tag.kind === "Primitive" && typeof tag.value === "string"
      ? { kind: "BuiltinTag", name: tag.value }
      : tag.kind === "Global"
        ? {
            kind: "Component",
            name: getComponentName(tag),
            declaration: parts.declaration,
            isContext: parts.isContext,
          }
        : { kind: "DynamicTag", name: DYNAMIC_TAG_NAME };
  if (jsxTag.kind === "Component") renderedComponents.add(jsxTag.name);
  // React calls function children and locally declared components with props: render props.
  const functionChildren =
    jsxTag.kind === "BuiltinTag" ? [] : parts.children.filter((child) => child.kind === "Function");
  const renderFunctions = tag.kind === "Function" ? [tag] : [];
  const props: Array<JsxProp | JsxSpreadProp> = [
    ...parts.props,
    ...functionChildren.map((value): JsxProp => ({
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
  return { kind: "JsxExpression", tag: jsxTag, props, children: parts.children, loc: parts.loc };
};
