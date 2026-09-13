import type { JSXChild } from "oxc-parser";
import type {
  MacroJsxChild,
  MacroJsxChildSource,
  StaticElementValue,
  StaticValue,
  StubComponent,
} from "../types.js";
import { cleanJsxText } from "./jsx-text.js";
import { getObjectProperty } from "./values.js";

const EXPRESSION_SOURCE: MacroJsxChildSource = { kind: "expression" };

export const getStubExpandJsx = (type: StaticValue): StubComponent["expandJsx"] | null =>
  type.kind === "component-reference" && type.type.kind === "stub"
    ? (type.type.stub.expandJsx ?? null)
    : null;

const isRenderedChild = (node: JSXChild): boolean => {
  switch (node.type) {
    case "JSXText":
      return cleanJsxText(node.value) !== "";
    case "JSXExpressionContainer":
      return node.expression.type !== "JSXEmptyExpression";
    default:
      return true;
  }
};

const getElementChildValues = (
  element: StaticElementValue,
  count: number,
): StaticValue[] | null => {
  if (count === 0) return [];
  const children = getObjectProperty(element.props, "children");
  if (count === 1) return [children];
  return children.kind === "list" && children.items.length === count ? children.items : null;
};

const describeSource = (node: JSXChild, value: StaticValue): MacroJsxChildSource => {
  switch (node.type) {
    case "JSXText":
      return { kind: "text" };
    case "JSXExpressionContainer":
      if (node.expression.type === "Identifier") {
        return { kind: "identifier", name: node.expression.name };
      }
      return node.expression.type === "Literal" && typeof node.expression.value === "string"
        ? { kind: "text" }
        : EXPRESSION_SOURCE;
    case "JSXElement": {
      if (value.kind !== "element") return EXPRESSION_SOURCE;
      const nested = getElementChildValues(value, node.children.filter(isRenderedChild).length);
      return {
        kind: "element",
        children: nested && describeMacroJsxChildren(node.children, nested),
      };
    }
    default:
      return EXPRESSION_SOURCE;
  }
};

/** Pairs the evaluated children of a JSX element with the source each came from. */
export const describeMacroJsxChildren = (
  nodes: JSXChild[],
  values: StaticValue[],
): MacroJsxChild[] => {
  const rendered = nodes.filter(isRenderedChild);
  const hasSpread = nodes.some((node) => node.type === "JSXSpreadChild");
  if (hasSpread || rendered.length !== values.length) {
    return values.map((value) => ({ value, source: EXPRESSION_SOURCE }));
  }
  return rendered.map((node, index) => ({
    value: values[index],
    source: describeSource(node, values[index]),
  }));
};
