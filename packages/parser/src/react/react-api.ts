import { recordDerivation } from "../evaluate/predicates.js";
import type { ReactApi, StaticExternalValue, StaticValue } from "../types.js";

const REACT_PACKAGES = new Set(["react", "preact/compat"]);
const REACT_DOM_PACKAGES = new Set(["react-dom", "preact/compat"]);
const COMPILER_RUNTIME_SPECIFIERS = new Set(["react/compiler-runtime", "react-compiler-runtime"]);

/** `Symbol.for` key of the value `useMemoCache` fills a fresh cache with. */
export const REACT_MEMO_CACHE_SENTINEL_KEY = "react.memo_cache_sentinel";

const REACT_API_NAMES: ReadonlySet<string> = new Set<ReactApi>([
  "memo",
  "forwardRef",
  "lazy",
  "createContext",
  "createRef",
  "createElement",
  "cloneElement",
  "isValidElement",
  "Children",
  "Fragment",
  "StrictMode",
  "Suspense",
  "SuspenseList",
  "Profiler",
  "Activity",
  "ViewTransition",
  "Component",
  "PureComponent",
  "useState",
  "useReducer",
  "useMemo",
  "useCallback",
  "useRef",
  "createRef",
  "useContext",
  "use",
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useImperativeHandle",
  "useDebugValue",
  "useId",
  "useTransition",
  "useDeferredValue",
  "useSyncExternalStore",
  "useOptimistic",
  "useActionState",
  "useMemoCache",
  "startTransition",
  "cache",
  "jsx",
  "jsxs",
  "jsxDEV",
]);

const REACT_DOM_API_NAMES: ReadonlySet<string> = new Set<ReactApi>([
  "createPortal",
  "flushSync",
  "batchedUpdates",
  "createRoot",
  "hydrateRoot",
  "render",
  "hydrate",
]);

const CHILDREN_API_NAMES: ReadonlySet<string> = new Set<ReactApi>([
  "Children.map",
  "Children.forEach",
  "Children.count",
  "Children.only",
  "Children.toArray",
]);

const UNSTABLE_PREFIX = "unstable_";
const EXPERIMENTAL_PREFIX = "experimental_";

const normalizeApiName = (name: string): string => {
  if (name.startsWith(UNSTABLE_PREFIX)) return name.slice(UNSTABLE_PREFIX.length);
  if (name.startsWith(EXPERIMENTAL_PREFIX)) return name.slice(EXPERIMENTAL_PREFIX.length);
  return name;
};

const isReactApi = (candidate: string, names: ReadonlySet<string>): candidate is ReactApi =>
  names.has(candidate);

export const resolveReactApi = (
  packageName: string,
  importedName: string,
  specifier = packageName,
): ReactApi | null => {
  if (COMPILER_RUNTIME_SPECIFIERS.has(specifier)) {
    return importedName === "c" ? "useMemoCache" : null;
  }
  const normalized = normalizeApiName(importedName);
  if (REACT_PACKAGES.has(packageName) && isReactApi(normalized, REACT_API_NAMES)) return normalized;
  if (REACT_DOM_PACKAGES.has(packageName) && isReactApi(normalized, REACT_DOM_API_NAMES)) {
    return normalized;
  }
  return null;
};

const SYMBOL_API_NAMES: ReadonlySet<ReactApi> = new Set<ReactApi>([
  "Fragment",
  "StrictMode",
  "Suspense",
  "SuspenseList",
  "Profiler",
  "Activity",
  "ViewTransition",
]);

export const getReactApiTypeof = (api: ReactApi): string => {
  if (SYMBOL_API_NAMES.has(api)) return "symbol";
  return api === "Children" ? "object" : "function";
};

export const isReactLikePackage = (packageName: string): boolean =>
  REACT_PACKAGES.has(packageName) || REACT_DOM_PACKAGES.has(packageName);

/** A member read off an external binding: a React API for React-like packages, otherwise an opaque derived value. */
export const getExternalMember = (object: StaticExternalValue, key: string): StaticValue => {
  if (
    isReactLikePackage(object.packageName) &&
    (object.importedName === "*" || object.importedName === "default")
  ) {
    const api = resolveReactApi(object.packageName, key);
    if (api) return { kind: "react-api", api };
  }
  return recordDerivation(
    {
      kind: "external",
      packageName: object.packageName,
      importedName: `${object.importedName}.${key}`,
      origin: "derived",
    },
    { kind: "property", object, key },
  );
};

export const resolveReactApiMember = (api: ReactApi, memberName: string): StaticValue | null => {
  if (api !== "Children") return null;
  const candidate = `Children.${memberName}`;
  if (isReactApi(candidate, CHILDREN_API_NAMES)) return { kind: "react-api", api: candidate };
  return null;
};
