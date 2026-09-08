import {
  ForwardRefTag,
  LazyComponentTag,
  MemoComponentTag,
  SimpleMemoComponentTag,
  type WorkTag,
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

/** Own keys of the object a stub stands in for, by the work tag its fibers report. */
export const getStubOwnKeys = (tag: WorkTag | undefined): ReadonlySet<string> => {
  switch (tag) {
    case ForwardRefTag:
      return WRAPPER_OWN_KEYS["forward-ref"];
    case MemoComponentTag:
    case SimpleMemoComponentTag:
      return WRAPPER_OWN_KEYS.memo;
    case LazyComponentTag:
      return WRAPPER_OWN_KEYS.lazy;
    default:
      return FUNCTION_OWN_KEYS;
  }
};

/** `Symbol.for` keys React tags elements with; renamed in 19 (shared/ReactSymbols.js). */
export const REACT_ELEMENT_SYMBOL_KEYS = new Set(["react.element", "react.transitional.element"]);

export const getReactElementSymbolKey = (reactVersion: string | null): string =>
  reactVersion && Number(reactVersion.split(".")[0]) < 19
    ? "react.element"
    : "react.transitional.element";
