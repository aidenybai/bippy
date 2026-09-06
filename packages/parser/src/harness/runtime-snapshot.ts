import { type Fiber, getDisplayName, getReactWorkTagsForFiber, type ReactWorkTagMap } from "bippy";
import type { WorkTagName } from "../fiber/types.js";
import type { FiberSnapshot } from "../snapshot/types.js";

const WORK_TAG_NAMES: ReadonlySet<string> = new Set<WorkTagName>([
  "FunctionComponent",
  "ClassComponent",
  "HostRoot",
  "HostPortal",
  "HostComponent",
  "HostText",
  "Fragment",
  "Mode",
  "ContextConsumer",
  "ContextProvider",
  "ForwardRef",
  "Profiler",
  "SuspenseComponent",
  "MemoComponent",
  "SimpleMemoComponent",
  "SuspenseListComponent",
  "OffscreenComponent",
  "HostHoistable",
  "HostSingleton",
  "ViewTransitionComponent",
  "ActivityComponent",
]);

const isWorkTagName = (name: string): name is WorkTagName => WORK_TAG_NAMES.has(name);

const HOOK_BEARING_TAGS = new Set<WorkTagName | null>([
  "FunctionComponent",
  "ForwardRef",
  "SimpleMemoComponent",
]);

export const getWorkTagName = (fiber: Fiber): WorkTagName | null => {
  const workTags: ReactWorkTagMap = getReactWorkTagsForFiber(fiber);
  for (const [name, value] of Object.entries(workTags)) {
    if (value === fiber.tag && isWorkTagName(name)) return name;
  }
  return null;
};

/** Length of the hook state list (`memoizedState`) on a function-like fiber. */
const countHooks = (fiber: Fiber, tag: WorkTagName | null): number | null => {
  if (!HOOK_BEARING_TAGS.has(tag)) return null;
  let count = 0;
  let node: unknown = fiber.memoizedState;
  while (node && typeof node === "object" && "queue" in node && "next" in node) {
    count++;
    node = node.next;
  }
  return count;
};

const getRuntimeText = (fiber: Fiber, tag: WorkTagName | null): string | null => {
  if (tag !== "HostText") return null;
  const props: unknown = fiber.memoizedProps;
  return typeof props === "string" ? props : String(props);
};

const getRuntimeKey = (fiber: Fiber): string | null =>
  typeof fiber.key === "string" ? fiber.key : null;

const getRuntimeName = (fiber: Fiber, tag: WorkTagName | null): string | null => {
  if (tag === "HostText" || tag === "HostRoot") return null;
  return getDisplayName(fiber.type);
};

interface RuntimeSnapshotState {
  nextId: number;
  /** Fibers and their alternates, since `_debugOwner` may point at either version. */
  ids: Map<object, number>;
}

const getOwnerId = (fiber: Fiber, state: RuntimeSnapshotState): number | null => {
  const owner: unknown = fiber._debugOwner;
  if (!owner || typeof owner !== "object" || !("tag" in owner)) return null;
  return state.ids.get(owner) ?? null;
};

const snapshotFiber = (fiber: Fiber, state: RuntimeSnapshotState): FiberSnapshot => {
  const id = state.nextId++;
  state.ids.set(fiber, id);
  if (fiber.alternate) state.ids.set(fiber.alternate, id);
  const tag = getWorkTagName(fiber);
  const children: FiberSnapshot[] = [];
  for (let child = fiber.child; child; child = child.sibling)
    children.push(snapshotFiber(child, state));
  return {
    kind: "fiber",
    id,
    owner: getOwnerId(fiber, state),
    tag,
    name: getRuntimeName(fiber, tag),
    key: getRuntimeKey(fiber),
    text: getRuntimeText(fiber, tag),
    children,
    hooks: countHooks(fiber, tag),
    annotations: [],
    fallback: null,
    location: null,
  };
};

/** Snapshot of a committed fiber tree, starting at the `HostRoot` fiber. */
export const snapshotRuntimeFiber = (root: Fiber): FiberSnapshot =>
  snapshotFiber(root, { nextId: 0, ids: new Map() });
