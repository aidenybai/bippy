import type { JsxExpressionValue, JsxTag, SymbolicValue } from "../../../src/core/types";
import { isRenderingNothing } from "../../../src/core/render/is-rendering-nothing";
import { normalizeText } from "../verifier/shapes";

export type ExpectedShape =
  | { kind: "element"; tag: string; children: ExpectedShape[] }
  | { kind: "component"; name: string }
  | { kind: "text"; text: string }
  | { kind: "hole" }
  | { kind: "repeat"; item: ExpectedShape[] }
  | { kind: "choice"; options: ExpectedShape[][] };

const TRANSPARENT_EXPORTS = new Set(["Fragment", "Suspense", "StrictMode", "Profiler"]);
const CONTEXT_TAG_PATTERN = /(^|\.)(Provider|Consumer)$/;

const getExportName = (tag: JsxTag): string =>
  (tag.kind === "Component" ? tag.reactExport : null) ?? tag.name.split(".").at(-1) ?? tag.name;

const getComponentName = (name: string): string => name.split(".").pop() ?? name;

const jsxElementToExpected = (element: JsxExpressionValue): ExpectedShape[] => {
  const { tag } = element;
  if (tag.kind === "DynamicTag") return [{ kind: "hole" }];
  if (TRANSPARENT_EXPORTS.has(getExportName(tag))) return element.children.flatMap(toExpected);
  if (CONTEXT_TAG_PATTERN.test(tag.name))
    return [
      {
        kind: "choice",
        options: [
          element.children.flatMap(toExpected),
          [{ kind: "component", name: getComponentName(tag.name) }],
        ],
      },
    ];
  if (tag.kind === "Component" && tag.isContext) return element.children.flatMap(toExpected);
  if (tag.kind === "Component") return [{ kind: "component", name: getComponentName(tag.name) }];
  const hasSpreadChildren =
    element.children.length === 0 &&
    element.props.some((prop) => prop.kind === "JsxSpreadAttribute");
  return [
    {
      kind: "element",
      tag: tag.name,
      children: hasSpreadChildren ? [{ kind: "hole" }] : element.children.flatMap(toExpected),
    },
  ];
};

export const toExpected = (value: SymbolicValue): ExpectedShape[] => {
  switch (value.kind) {
    case "JsxExpression":
      return jsxElementToExpected(value);
    case "JsxFragment":
      return value.children.flatMap(toExpected);
    case "JSXText": {
      const text = normalizeText(value.value);
      return text ? [{ kind: "text", text }] : [];
    }
    case "ArrayMap":
      return [{ kind: "repeat", item: toExpected(value.item) }];
    case "Conditional":
      return [
        { kind: "choice", options: [toExpected(value.consequent), toExpected(value.alternate)] },
      ];
    case "Primitive": {
      if (isRenderingNothing(value)) return [];
      const text = normalizeText(String(value.value));
      return text ? [{ kind: "text", text }] : [];
    }
    default:
      return [{ kind: "hole" }];
  }
};
