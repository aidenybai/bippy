import type { WorkTagName } from "../fiber/types.js";

/**
 * Serializable projection of a fiber tree, shared by the static builder and
 * the runtime capture so the two can be compared and stored as JSON.
 */
export interface FiberSnapshot {
  kind: "fiber";
  /** Pre-order index within the tree. */
  id: number;
  /** `id` of the fiber whose render created this one (`_debugOwner`). */
  owner: number | null;
  tag: WorkTagName | null;
  name: string | null;
  key: string | null;
  text: string | null;
  children: NodeSnapshot[];
  /** Hook names recorded statically, or the number of hook states seen at runtime. */
  hooks: string[] | number | null;
  annotations: string[];
  /** Suspense fallback as it would mount while the primary tree is suspended. */
  fallback: NodeSnapshot[] | null;
  location: string | null;
}

export interface BranchSnapshot {
  kind: "branch";
  test: string;
  alternatives: NodeSnapshot[][];
}

export interface ListSnapshot {
  kind: "list";
  description: string;
  items: NodeSnapshot[];
}

export interface UnknownSnapshot {
  kind: "unknown";
  description: string;
}

export type NodeSnapshot = FiberSnapshot | BranchSnapshot | ListSnapshot | UnknownSnapshot;
