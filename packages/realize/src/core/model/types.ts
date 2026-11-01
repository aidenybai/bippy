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

export interface Value {
  label: string;
  abstract: Abstract;
}

export type VariableSource = "state" | "input" | "derived" | "test" | "pending";

export interface Variable {
  name: string;
  label: string;
  source: VariableSource;
  bindingKind: BindingKind | null;
  bindingId: number | null;
  inputBindingIds: number[];
  path: string[];
  domain: Value[];
  initial: string[];
}

export type Predicate =
  | { kind: "True" }
  | { kind: "False" }
  | { kind: "In"; variable: string; values: string[]; domain: string[] }
  | { kind: "Not"; operand: Predicate }
  | { kind: "And"; conjuncts: Predicate[] }
  | { kind: "Or"; disjuncts: Predicate[] };

export type NextValue =
  | { kind: "Values"; values: string[] }
  | { kind: "Unchanged" }
  | { kind: "If"; predicate: Predicate; consequent: NextValue; alternate: NextValue };

export type ActionPhase = "run" | "resolves" | "rejects" | "input";

export interface Action {
  name: string;
  label: string;
  handlerId: string | null;
  phase: ActionPhase;
  guard: Predicate;
  writes: Array<{ variable: string; next: NextValue }>;
  writtenBindingIds: number[];
  isVisible: boolean;
  loc: SourceLocation | null;
}

export interface View {
  name: string;
  label: string;
  predicate: Predicate;
  path: string[];
}

export interface BranchEdge {
  predicate: Predicate;
  isReachable: boolean | null;
}

export interface Branch {
  test: string;
  loc: SourceLocation;
  file: string;
  consequent: BranchEdge;
  alternate: BranchEdge;
}

export interface TraceStep {
  action: string | null;
  state: Record<string, string>;
  view: string;
}

export interface ViewEdge {
  from: string;
  to: string;
  action: string;
  actionName: string;
  handlerId: string | null;
  isAsync: boolean;
  isInput: boolean;
}

export interface StateSpace {
  stateCount: number;
  isTruncated: boolean;
  initialViews: string[];
  reachableViews: string[];
  edges: ViewEdge[];
}

export interface Property {
  name: string;
  label: string;
  predicate: Predicate;
  loc: SourceLocation;
}

export type FindingKind = "unreachable-branch" | "stuttering-action" | "violated-assertion";

export interface Finding {
  kind: FindingKind;
  message: string;
  loc: SourceLocation | null;
  trace: TraceStep[] | null;
}

export interface ComponentModel {
  variables: Variable[];
  actions: Action[];
  views: View[];
  branches: Branch[];
  properties: Property[];
  stateSpace: StateSpace;
  findings: Finding[];
}
