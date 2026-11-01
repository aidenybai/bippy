import type { BindingKind, PrimitiveValue, SourceLocation } from "../types";

export type Abstract =
  | { kind: "Exact"; value: PrimitiveValue }
  | {
      kind: "Range";
      min: number;
      max: number;
      isMinIncluded: boolean;
      isMaxIncluded: boolean;
    }
  | { kind: "Other"; type: "string" | "any"; excluded: PrimitiveValue[] }
  | { kind: "Object"; typeText: string }
  | { kind: "Truthy" }
  | { kind: "Falsy" }
  | { kind: "Any" };

export interface Cell {
  label: string;
  value: Abstract;
}

export type LaneSource = "state" | "input" | "derived" | "test" | "pending";

export interface Lane {
  name: string;
  label: string;
  source: LaneSource;
  bindingKind: BindingKind | null;
  bindingId: number | null;
  inputBindingIds: number[];
  path: string[];
  cells: Cell[];
  initial: string[];
}

export type Condition =
  | { kind: "True" }
  | { kind: "False" }
  | { kind: "In"; lane: string; cells: string[] }
  | { kind: "Not"; condition: Condition }
  | { kind: "And"; conditions: Condition[] }
  | { kind: "Or"; conditions: Condition[] };

export type Choice =
  | { kind: "Cells"; cells: string[] }
  | { kind: "Keep" }
  | { kind: "If"; condition: Condition; then: Choice; otherwise: Choice };

export type ActionPhase = "run" | "resolves" | "rejects" | "input";

export interface Action {
  name: string;
  label: string;
  handlerId: string | null;
  phase: ActionPhase;
  guard: Condition;
  writes: Array<{ lane: string; choice: Choice }>;
  writtenBindingIds: number[];
  isVisible: boolean;
  loc: SourceLocation | null;
}

export interface Screen {
  name: string;
  label: string;
  condition: Condition;
  conditions: string[];
}

export interface Arm {
  test: string;
  isTrueSide: boolean;
  isReachable: boolean | null;
  condition: Condition;
  loc: SourceLocation;
  file: string;
}

export interface TraceStep {
  action: string | null;
  cells: Record<string, string>;
  screen: string;
}

export interface ScreenEdge {
  from: string;
  to: string;
  action: string;
  actionName: string;
  handlerId: string | null;
  isAsync: boolean;
  isInput: boolean;
}

export interface Exploration {
  stateCount: number;
  isTruncated: boolean;
  initialScreens: string[];
  reachableScreens: string[];
  edges: ScreenEdge[];
}

export type FindingKind = "unreachable-arm" | "silent-action" | "invariant";

export interface Finding {
  kind: FindingKind;
  message: string;
  loc: SourceLocation | null;
  trace: TraceStep[] | null;
}

export interface ComponentModel {
  lanes: Lane[];
  actions: Action[];
  screens: Screen[];
  arms: Arm[];
  exploration: Exploration;
  findings: Finding[];
}
