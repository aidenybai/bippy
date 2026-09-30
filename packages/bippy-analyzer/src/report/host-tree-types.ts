import type { Guard } from "../symbolic/guards.js";

export interface HostJsonObject {
  readonly [name: string]: HostJsonValue;
}

export type HostJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly HostJsonValue[]
  | HostJsonObject;

export interface HostTreeCommitInput {
  readonly kind: "commit";
  readonly snapshot: string;
}

export interface HostTreeDiagnostic {
  readonly kind: "throw" | "unsupported" | "incomplete" | "engine-failure" | "mismatch";
  readonly message: string;
  readonly name?: string;
}

export interface GuardedHostTreeInput {
  readonly id: string;
  readonly guard: Guard;
  readonly outcome: HostTreeCommitInput | HostTreeDiagnostic;
}

export interface HostTextNode {
  readonly id: number;
  readonly kind: "text";
  readonly text: string;
}

export interface HostElementNode {
  readonly id: number;
  readonly kind: "element";
  readonly type: string;
  readonly props: HostJsonObject;
  readonly children: readonly number[] | null;
}

export type HostTreeNode = HostTextNode | HostElementNode;

export interface HostTreeCommit {
  readonly kind: "commit";
  readonly shape: "empty" | "single" | "array";
  readonly roots: readonly number[];
}

export interface GuardedHostTreeObservation {
  readonly id: string;
  readonly guard: Guard;
  readonly outcome: HostTreeCommit | HostTreeDiagnostic;
}

export interface HostTreeReportLimits {
  readonly maxObservations: number;
  readonly maxNodes: number;
  readonly maxEntries: number;
  readonly maxDepth: number;
  readonly maxSnapshotCharacters: number;
}

export interface HostTreeReportOptions extends Partial<HostTreeReportLimits> {}

export interface GuardedHostTreeReport {
  readonly scope: "guarded-host-tree-observations-v1";
  readonly execution: "not-verified";
  readonly coverage: "not-verified";
  readonly inputs: readonly string[];
  readonly observations: readonly GuardedHostTreeObservation[];
  readonly nodes: readonly HostTreeNode[];
  readonly limits: HostTreeReportLimits;
}

export interface SelectedHostTreeObservation {
  readonly kind: "selected";
  readonly observationId: string;
  readonly outcome: HostTreeCommitInput | HostTreeDiagnostic;
}

export interface UncoveredHostTreeObservation {
  readonly kind: "uncovered";
}

export interface AmbiguousHostTreeObservation {
  readonly kind: "ambiguous";
  readonly observationIds: readonly string[];
}

export type HostTreeSpecialization =
  | SelectedHostTreeObservation
  | UncoveredHostTreeObservation
  | AmbiguousHostTreeObservation;

export class HostTreeReportError extends Error {
  override name = "HostTreeReportError";
  constructor(
    readonly code: "invalid-input" | "budget-exceeded",
    message: string,
  ) {
    super(message);
  }
}
