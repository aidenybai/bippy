import { Fragment, StrictMode, Suspense, createElement, type ElementType } from "react";

const HOST_TAGS = ["div", "span", "p", "b", "i", "u", "s", "em", "strong", "small"] as const;

const makeComponent =
  (tagName: string): ElementType =>
  (props: Record<string, unknown>) =>
    createElement(tagName, { ...props, "data-source": tagName });

const sources = HOST_TAGS.map(makeComponent);

const interopComponents = new Map<ElementType, ElementType>(
  sources.map((source, index) => [
    source,
    (props: Record<string, unknown>) =>
      createElement("section", { ...props, "data-interop": HOST_TAGS[index] }),
  ]),
);

const wrap = (type: ElementType, props: Record<string, unknown> | null, ...children: unknown[]) =>
  createElement(interopComponents.get(type) ?? type, props, ...children);

const ReactApiMapKey = () =>
  wrap(
    Fragment,
    null,
    wrap(sources[0], {}, "first"),
    wrap(StrictMode, null, wrap(sources[3], {}, "fourth")),
    wrap(Suspense, { fallback: null }, wrap("article", {}, wrap(sources[9], {}, "tenth"))),
  );

export default ReactApiMapKey;
export const isExact = true;
