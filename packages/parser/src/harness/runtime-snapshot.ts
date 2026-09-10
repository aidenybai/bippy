import type { Fiber, FiberRoot, ReactRenderer, ReactWorkTagMap } from "bippy";
import { getDisplayName, getReactWorkTagsForFiber } from "bippy";
import type {
  RuntimeFiberSnapshot,
  RuntimeSnapshot,
  SnapshotPropValue,
  SnapshotWorkTag,
} from "./snapshot.js";
import { isMarkerName } from "../materialize/markers.js";

const MAX_STRING_PROP_LENGTH = 200;
// Vite's SSR transform names an anonymous `export default` after its export slot.
const VITE_SSR_DEFAULT_EXPORT_NAME = "__vite_ssr_export_default__";

const getComponentName = (type: unknown): string | null => {
  const name = getDisplayName(type);
  return name === VITE_SSR_DEFAULT_EXPORT_NAME ? "default" : name;
};

const SNAPSHOT_TAG_KEYS: Array<[keyof ReactWorkTagMap, SnapshotWorkTag]> = [
  ["FunctionComponent", "FunctionComponent"],
  ["ClassComponent", "ClassComponent"],
  ["HostRoot", "HostRoot"],
  ["HostPortal", "HostPortal"],
  ["HostComponent", "HostComponent"],
  ["HostText", "HostText"],
  ["Fragment", "Fragment"],
  ["Mode", "Mode"],
  ["ContextConsumer", "ContextConsumer"],
  ["ContextProvider", "ContextProvider"],
  ["ForwardRef", "ForwardRef"],
  ["Profiler", "Profiler"],
  ["SuspenseComponent", "SuspenseComponent"],
  ["MemoComponent", "MemoComponent"],
  ["SimpleMemoComponent", "SimpleMemoComponent"],
  ["LazyComponent", "LazyComponent"],
  ["SuspenseListComponent", "SuspenseListComponent"],
  ["OffscreenComponent", "OffscreenComponent"],
  ["HostHoistable", "HostHoistable"],
  ["HostSingleton", "HostSingleton"],
  ["Throw", "Throw"],
  ["ViewTransitionComponent", "ViewTransitionComponent"],
  ["ActivityComponent", "ActivityComponent"],
  ["CacheComponent", "CacheComponent"],
  ["TracingMarkerComponent", "TracingMarkerComponent"],
  ["LegacyHiddenComponent", "LegacyHiddenComponent"],
  ["ScopeComponent", "ScopeComponent"],
  ["DehydratedSuspenseComponent", "DehydratedSuspenseComponent"],
  ["IncompleteClassComponent", "IncompleteClassComponent"],
  ["IncompleteFunctionComponent", "IncompleteFunctionComponent"],
];

const buildTagLookup = (workTags: Readonly<ReactWorkTagMap>): Map<number, SnapshotWorkTag> => {
  const lookup = new Map<number, SnapshotWorkTag>();
  for (const [mapKey, snapshotTag] of SNAPSHOT_TAG_KEYS) {
    const value = workTags[mapKey];
    if (value >= 0 && !lookup.has(value)) lookup.set(value, snapshotTag);
  }
  return lookup;
};

const toPropValue = (value: unknown, isUntruncated: boolean): SnapshotPropValue | undefined => {
  switch (typeof value) {
    case "string":
      return value.length > MAX_STRING_PROP_LENGTH && !isUntruncated
        ? `${value.slice(0, MAX_STRING_PROP_LENGTH)}…`
        : value;
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "undefined":
      return undefined;
    case "function":
      return "[function]";
    case "symbol":
      return value.toString();
    default:
      if (value === null) return null;
      if (Array.isArray(value)) return "[array]";
      return "[object]";
  }
};

/** Marker props carry serialized guards the pattern reader parses back, so they are kept whole. */
const snapshotProps = (
  memoizedProps: unknown,
  isMarker: boolean,
): Record<string, SnapshotPropValue> => {
  const result: Record<string, SnapshotPropValue> = {};
  if (typeof memoizedProps !== "object" || memoizedProps === null) return result;
  for (const [key, value] of Object.entries(memoizedProps)) {
    if (key === "children") continue;
    const propValue = toPropValue(value, isMarker);
    if (propValue !== undefined) result[key] = propValue;
  }
  return result;
};

const getContextName = (type: unknown): string | null => {
  if (typeof type !== "object" || type === null) return null;
  const record: Record<string, unknown> = Object(type);
  const displayName = record.displayName;
  if (typeof displayName === "string" && displayName) return displayName;
  const inner = record._context;
  if (typeof inner === "object" && inner !== null) {
    const innerName = Object(inner).displayName;
    if (typeof innerName === "string" && innerName) return innerName;
  }
  return null;
};

const getFiberName = (fiber: Fiber, tag: SnapshotWorkTag): string | null => {
  switch (tag) {
    case "HostRoot":
      return "HostRoot";
    case "HostText":
      return null;
    case "Fragment":
      return "Fragment";
    case "Mode":
      return "StrictMode";
    case "Profiler":
      return "Profiler";
    case "SuspenseComponent":
      return "Suspense";
    case "SuspenseListComponent":
      return "SuspenseList";
    case "OffscreenComponent":
      return "Offscreen";
    case "ActivityComponent":
      return "Activity";
    case "ViewTransitionComponent":
      return "ViewTransition";
    case "HostPortal":
      return "Portal";
    case "ContextProvider":
    case "ContextConsumer":
      return getContextName(fiber.type);
    case "MemoComponent":
    case "SimpleMemoComponent":
      // React DevTools prefers the memo wrapper's own displayName over the
      // wrapped function's name; fiber.type is already the inner function.
      return getComponentName(fiber.elementType) ?? getComponentName(fiber.type);
    default:
      return getComponentName(fiber.type);
  }
};

const snapshotFiber = (
  fiber: Fiber,
  lookup: Map<number, SnapshotWorkTag>,
): RuntimeFiberSnapshot => {
  const tag = lookup.get(fiber.tag) ?? "Unknown";
  const children: RuntimeFiberSnapshot[] = [];
  let child = fiber.child;
  while (child) {
    children.push(snapshotFiber(child, lookup));
    child = child.sibling;
  }
  const key = fiber.key;
  const name = getFiberName(fiber, tag);
  return {
    tag,
    name,
    key: typeof key === "string" ? key : null,
    text: tag === "HostText" ? String(fiber.memoizedProps) : null,
    props: tag === "HostText" ? {} : snapshotProps(fiber.memoizedProps, isMarkerName(name)),
    children,
  };
};

export const snapshotFiberTree = (rootFiber: Fiber): RuntimeFiberSnapshot =>
  snapshotFiber(rootFiber, buildTagLookup(getReactWorkTagsForFiber(rootFiber)));

/** The host container a root renders into (`containerInfo` is not part of bippy's public FiberRoot shape). */
export const getRootContainer = (root: FiberRoot): unknown =>
  "containerInfo" in root ? root.containerInfo : null;

const getRootContainerName = (root: FiberRoot): string | null => {
  const container = getRootContainer(root);
  if (typeof container !== "object" || container === null) return null;
  const nodeName: unknown = Object(container).nodeName;
  return typeof nodeName === "string" ? nodeName.toLowerCase() : null;
};

/** The root's fiber tree; its `HostRoot` carries the container's node name (`div`, `#document`, a custom element) as `container`. */
const snapshotRoot = (root: FiberRoot): RuntimeFiberSnapshot => {
  const tree = snapshotFiberTree(root.current);
  const container = getRootContainerName(root);
  return container === null ? tree : { ...tree, props: { container } };
};

interface RuntimeSnapshotSource {
  roots: FiberRoot[];
  renderer: ReactRenderer | null;
}

export const createRuntimeSnapshot = (source: RuntimeSnapshotSource): RuntimeSnapshot => ({
  reactVersion: source.renderer?.version ?? null,
  rendererName: source.renderer?.rendererPackageName ?? null,
  buildType: source.renderer
    ? source.renderer.bundleType === 1
      ? "development"
      : "production"
    : null,
  roots: source.roots.map(snapshotRoot),
  capturedAt: new Date().toISOString(),
});
