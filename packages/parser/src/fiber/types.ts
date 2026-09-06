import type { HookCall } from "../analyze/hooks.js";
import type { ObjectValue, StaticValue } from "../analyze/values.js";
import type { SourceLocation } from "../module/location.js";

/**
 * Names of React's fiber work tags (`ReactWorkTags.js`). Names rather than
 * numbers because the numbering differs between React versions; the runtime
 * harness maps numeric tags back to these names per renderer.
 */
export type WorkTagName =
  | "FunctionComponent"
  | "ClassComponent"
  | "HostRoot"
  | "HostPortal"
  | "HostComponent"
  | "HostText"
  | "Fragment"
  | "Mode"
  | "ContextConsumer"
  | "ContextProvider"
  | "ForwardRef"
  | "Profiler"
  | "SuspenseComponent"
  | "MemoComponent"
  | "SimpleMemoComponent"
  | "SuspenseListComponent"
  | "OffscreenComponent"
  | "HostHoistable"
  | "HostSingleton"
  | "ViewTransitionComponent"
  | "ActivityComponent";

export interface StaticFiber {
  kind: "fiber";
  /** `null` when the component's implementation is outside the analyzed graph. */
  tag: WorkTagName | null;
  name: string | null;
  key: string | null;
  /** Text content for `HostText`; `null` when only known at runtime. */
  text: string | null;
  props: ObjectValue | null;
  /** The element type that created this fiber (`fiber.type`). */
  type: StaticValue | null;
  /** Where the element that created this fiber was written. */
  location: SourceLocation | null;
  /** Component fiber whose render created this fiber's element (`_debugOwner`). */
  owner: StaticFiber | null;
  parent: StaticFiber | null;
  children: StaticNode[];
  hooks: HookCall[];
  /** Display-only facts such as `mode=hidden`, `lazy` or `use client`. */
  annotations: string[];
  /** Suspense fallback subtree, mounted instead of `children` while suspended. */
  fallback: StaticNode[] | null;
}

/** One of several possible child sequences, decided at runtime. */
export interface BranchNode {
  kind: "branch";
  test: string;
  alternatives: StaticNode[][];
}

/** Zero or more repetitions of `items`, the shape produced by `.map()`. */
export interface ListNode {
  kind: "list";
  description: string;
  items: StaticNode[];
}

/** Children the analysis could not determine; matches any runtime subtree. */
export interface UnknownNode {
  kind: "unknown";
  description: string;
}

export type StaticNode = StaticFiber | BranchNode | ListNode | UnknownNode;

export interface StaticRoot {
  root: StaticFiber;
  fiberCount: number;
  unknownCount: number;
}
