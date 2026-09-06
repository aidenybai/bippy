import type { SourceLocation } from "../module/location.js";
import {
  array,
  describeValue,
  object,
  type StaticValue,
  text,
  UNDEFINED,
  unknown,
} from "./values.js";

export interface HookCall {
  /** Callee as written, e.g. `useState` or `React.useEffect`. */
  name: string;
  isBuiltin: boolean;
  location: SourceLocation | null;
}

const BUILTIN_HOOK_NAMES = new Set([
  "use",
  "useActionState",
  "useCallback",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useEffect",
  "useEffectEvent",
  "useFormStatus",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useOptimistic",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
]);

export const isBuiltinHookName = (name: string): boolean => BUILTIN_HOOK_NAMES.has(name);

/**
 * Models the return value of a React hook for the first render. State is
 * treated as unknown rather than its initial value: the runtime tree is
 * observed after effects ran, so branching on state must stay a branch.
 * `useMemo` callbacks are evaluated because they must be pure.
 */
export const modelBuiltinHook = (
  name: string,
  args: StaticValue[],
  callFunction: (fn: StaticValue, callArguments: StaticValue[]) => StaticValue,
  readContext: (target: StaticValue) => StaticValue,
): StaticValue => {
  const [first, second] = args;
  switch (name) {
    case "useState":
      return array([
        unknown(`state${first ? ` (initially ${describeValue(first)})` : ""}`),
        unknown("setState"),
      ]);
    case "useReducer":
      return array([unknown("reducer state"), unknown("dispatch")]);
    case "useRef":
      return object([["current", first ?? UNDEFINED]]);
    case "useMemo":
      return first ? callFunction(first, []) : unknown("useMemo()");
    case "useCallback":
    case "useEffectEvent":
      return first ?? unknown(`${name}()`);
    case "useDeferredValue":
      return first ?? UNDEFINED;
    case "useOptimistic":
      return array([first ?? UNDEFINED, unknown("setOptimistic")]);
    case "useActionState":
      return array([second ?? UNDEFINED, unknown("formAction"), unknown("isPending")]);
    case "useTransition":
      return array([unknown("isPending"), unknown("startTransition")]);
    case "useFormStatus":
      return object([
        ["pending", unknown("pending")],
        ["data", unknown("data")],
        ["method", unknown("method")],
        ["action", unknown("action")],
      ]);
    case "useId":
      return text("useId()");
    case "useEffect":
    case "useLayoutEffect":
    case "useInsertionEffect":
    case "useImperativeHandle":
    case "useDebugValue":
      return UNDEFINED;
    case "useContext":
      return first ? readContext(first) : unknown("useContext()");
    case "useSyncExternalStore":
      return unknown("external store snapshot");
    case "use":
      if (first?.kind === "component") return readContext(first);
      return unknown(`use(${first ? describeValue(first) : ""})`);
    default:
      return unknown(`${name}()`);
  }
};
