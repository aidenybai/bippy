import { readFileSync } from "node:fs";
import type { ModuleResolver } from "../graph/module-resolver.js";
import type { WorkTag } from "../work-tags.js";
import {
  ForwardRefTag,
  LazyComponentTag,
  MemoComponentTag,
  SimpleMemoComponentTag,
} from "../work-tags.js";

/** Own keys of a development-mode `ReactElement` (react/src/jsx/ReactJSXElement.js). */
export const REACT_ELEMENT_OWN_KEYS = new Set([
  "$$typeof",
  "type",
  "key",
  "ref",
  "props",
  "_owner",
  "_store",
  "_debugInfo",
  "_debugStack",
  "_debugTask",
]);

/** Own keys of the objects `memo`/`forwardRef`/`lazy` return (react/src/ReactMemo.js, ReactForwardRef.js, ReactLazy.js). */
export const WRAPPER_OWN_KEYS = {
  memo: new Set(["$$typeof", "type", "compare"]),
  "forward-ref": new Set(["$$typeof", "render"]),
  lazy: new Set(["$$typeof", "_payload", "_init"]),
} as const;

/** The wrapper object a library component with this work tag is, or null for a plain function. */
export const getWrapperKindForTag = (tag: WorkTag): keyof typeof WRAPPER_OWN_KEYS | null => {
  switch (tag) {
    case ForwardRefTag:
      return "forward-ref";
    case MemoComponentTag:
    case SimpleMemoComponentTag:
      return "memo";
    case LazyComponentTag:
      return "lazy";
    default:
      return null;
  }
};

/** Keys a plain function has (or React reads off one) without ever being assigned in source. */
export const FUNCTION_OWN_KEYS = new Set([
  "length",
  "name",
  "prototype",
  "displayName",
  "defaultProps",
  "propTypes",
  "contextTypes",
]);

/** `Symbol.for` keys React tags elements with; renamed in 19 (shared/ReactSymbols.js). */
export const REACT_ELEMENT_SYMBOL_KEYS = new Set(["react.element", "react.transitional.element"]);

export const getReactElementSymbolKey = (reactVersion: string | null): string =>
  reactVersion && Number(reactVersion.split(".")[0]) < 19
    ? "react.element"
    : "react.transitional.element";

export const readReactVersion = (
  resolver: ModuleResolver,
  rootDirectory: string,
): string | null => {
  const resolution = resolver.resolve("react/package.json", `${rootDirectory}/index.js`);
  if (resolution.kind !== "external" || !resolution.filePath) return null;
  try {
    const manifest: unknown = JSON.parse(readFileSync(resolution.filePath, "utf8"));
    return typeof manifest === "object" &&
      manifest !== null &&
      "version" in manifest &&
      typeof manifest.version === "string"
      ? manifest.version
      : null;
  } catch {
    return null;
  }
};
