import type { ReactApi, StaticValue } from "../types.js";

const REACT_PACKAGES = new Set(["react", "preact/compat"]);
const REACT_DOM_PACKAGES = new Set(["react-dom", "preact/compat"]);

const REACT_API_NAMES: ReadonlySet<string> = new Set<ReactApi>([
  "memo",
  "forwardRef",
  "lazy",
  "createContext",
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
  "startTransition",
  "jsx",
  "jsxs",
  "jsxDEV",
]);

const REACT_DOM_API_NAMES: ReadonlySet<string> = new Set<ReactApi>([
  "createPortal",
  "flushSync",
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

export const resolveReactApi = (packageName: string, importedName: string): ReactApi | null => {
  const normalized = normalizeApiName(importedName);
  if (REACT_PACKAGES.has(packageName) && isReactApi(normalized, REACT_API_NAMES)) return normalized;
  if (REACT_DOM_PACKAGES.has(packageName) && isReactApi(normalized, REACT_DOM_API_NAMES)) {
    return normalized;
  }
  return null;
};

export const isReactLikePackage = (packageName: string): boolean =>
  REACT_PACKAGES.has(packageName) || REACT_DOM_PACKAGES.has(packageName);

export const resolveReactApiMember = (api: ReactApi, memberName: string): StaticValue | null => {
  if (api !== "Children") return null;
  const candidate = `Children.${memberName}`;
  if (isReactApi(candidate, CHILDREN_API_NAMES)) return { kind: "react-api", api: candidate };
  return null;
};
