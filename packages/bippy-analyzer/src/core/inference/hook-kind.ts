import type { CalleeName } from "./infer-domains.js";
import type { SymbolicValue } from "./types.js";

const REACT_HOOK_KINDS = [
  "useContext",
  "useState",
  "useActionState",
  "useReducer",
  "useRef",
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useMemo",
  "useCallback",
  "useTransition",
  "useImperativeHandle",
  "useEffectEvent",
  "useOptimistic",
] as const;

const REACT_MODULES = new Set(["react", "react-dom"]);

const HOOK_NAME_PATTERN = /^use[A-Z0-9]/;

export type HookKind = (typeof REACT_HOOK_KINDS)[number] | "Custom";

export const isHookName = (name: string): boolean => HOOK_NAME_PATTERN.test(name);

const getGlobalName = (callee: SymbolicValue): string | null =>
  callee.kind === "Global" ? (callee.name.split(".").at(-1) ?? null) : null;

const getReactExportName = (
  calleeName: CalleeName | null,
  callee: SymbolicValue,
): string | null => {
  if (calleeName?.reactExportName) return calleeName.reactExportName;
  return callee.kind === "Global" && callee.module !== null && REACT_MODULES.has(callee.module)
    ? getGlobalName(callee)
    : null;
};

/**
 * Tells which hook a call is. React's own hooks are found through the checker, which
 * follows aliases and re-exports, or through the import when the project has no React
 * types. Anything else named like a hook is a custom hook, the same rule the compiler uses.
 */
export const getHookKind = (
  calleeName: CalleeName | null,
  callee: SymbolicValue,
): HookKind | null => {
  const reactExportName = getReactExportName(calleeName, callee);
  const reactHookKind = REACT_HOOK_KINDS.find((hookKind) => hookKind === reactExportName);
  if (reactHookKind) return reactHookKind;
  const name = reactExportName ?? calleeName?.name ?? getGlobalName(callee);
  return name !== null && isHookName(name) ? "Custom" : null;
};
