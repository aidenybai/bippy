import type { HookKind } from "./hook-kind.js";
import type { InstructionId, SourceLocation } from "../hir/hir.js";

export type PrimitiveValue = string | number | boolean | null | undefined;

export type PrimitiveTypeName = "string" | "number" | "bigint" | "boolean";

/**
 * One value a place can hold. A `Literal` is exact; a `Type` stands for every value of a
 * type that is not split further, like `User` or `string`.
 */
export type AbstractValue =
  | { kind: "Literal"; value: PrimitiveValue }
  | { kind: "Type"; text: string; primitive: PrimitiveTypeName | null };

export type Truthiness = "truthy" | "falsy" | "either";

/**
 * How a decision reads its test: `truthy` branches on the value itself, `nullish` on
 * whether it is `!= null`.
 */
export type TestKind = "truthy" | "nullish";

type UnknownTypeReason = "any" | "unknown" | "never" | "unresolved";

/**
 * Every value a binding or one of its fields can hold, read from its TypeScript type.
 */
export type Domain =
  | { kind: "Cases"; cases: AbstractValue[]; origin: "type" | "call-sites" }
  | { kind: "Opaque"; typeText: string }
  | { kind: "Unknown"; reason: UnknownTypeReason };

/**
 * A prop value a test can mount with. It mirrors JSON so a browser can rebuild it.
 */
export type Sample =
  | { kind: "Value"; value: string | number | boolean | null }
  | { kind: "Undefined" }
  | { kind: "Function" }
  | { kind: "Array"; items: Sample[] }
  | { kind: "Object"; fields: Record<string, Sample> };

export type BindingKind = "prop" | "state" | "reducer" | "context" | "hook" | "ref" | "item";

/**
 * A name the render output depends on: a prop, a piece of state, a hook result, or a list item.
 */
export interface Binding {
  id: number;
  name: string;
  kind: BindingKind;
  hookKind: HookKind | null;
  propName: string | null;
  loc: SourceLocation;
  domain: Domain;
  samples: Sample[];
  initial: SymbolicValue | null;
}

/**
 * Where a decision came from: the terminal that branches, how its test is checked at
 * runtime, and the location of the test expression.
 */
export interface Decision {
  terminalId: InstructionId;
  probe: TestKind | "none";
  loc: SourceLocation;
}

export interface JsxProp {
  kind: "JsxAttribute";
  name: string;
  value: SymbolicValue;
  transitionId: string | null;
}

export interface JsxSpreadProp {
  kind: "JsxSpreadAttribute";
  value: SymbolicValue;
}

export type JsxTag = { kind: "BuiltinTag"; name: string } | { kind: "Component"; name: string };

interface SymbolicObjectProperty {
  key: string;
  value: SymbolicValue;
}

/**
 * The value of an instruction, computed symbolically. Kinds follow the HIR instruction they
 * come from. `Conditional` is where control flow merged: a phi, an early return, or a
 * ternary, logical, or switch.
 */
export type SymbolicValue =
  | { kind: "Primitive"; value: PrimitiveValue }
  | { kind: "Binding"; binding: Binding; path: string[] }
  | { kind: "BinaryExpression"; operator: string; left: SymbolicValue; right: SymbolicValue }
  | { kind: "UnaryExpression"; operator: string; value: SymbolicValue }
  | {
      kind: "Conditional";
      test: SymbolicValue;
      testKind: TestKind;
      consequent: SymbolicValue;
      alternate: SymbolicValue;
      decision: Decision;
    }
  | { kind: "ObjectExpression"; properties: SymbolicObjectProperty[]; spreads: SymbolicValue[] }
  | { kind: "ArrayExpression"; elements: SymbolicValue[]; spreads: SymbolicValue[] }
  | { kind: "ArrayMap"; array: SymbolicValue; item: SymbolicValue; loc: SourceLocation }
  | {
      kind: "JsxExpression";
      tag: JsxTag;
      props: Array<JsxProp | JsxSpreadProp>;
      children: SymbolicValue[];
      loc: SourceLocation;
    }
  | { kind: "JsxFragment"; children: SymbolicValue[] }
  | { kind: "JSXText"; value: string }
  | { kind: "Function"; functionId: number; loc: SourceLocation }
  | { kind: "Setter"; binding: Binding }
  | { kind: "Dispatch"; binding: Binding; reducer: SymbolicValue }
  | { kind: "Props" }
  | { kind: "HookResult"; hookKind: HookKind; name: string; args: SymbolicValue[] }
  | { kind: "Global"; name: string; module: string | null }
  | { kind: "Unknown"; reason: string; loc: SourceLocation };

export type ConditionalValue = Extract<SymbolicValue, { kind: "Conditional" }>;

export type JsxExpressionValue = Extract<SymbolicValue, { kind: "JsxExpression" }>;

export type BinaryExpressionValue = Extract<SymbolicValue, { kind: "BinaryExpression" }>;

export type BindingValue = Extract<SymbolicValue, { kind: "Binding" }>;

export type PrimitiveSymbolicValue = Extract<SymbolicValue, { kind: "Primitive" }>;

export type FunctionValue = Extract<SymbolicValue, { kind: "Function" }>;

export type SetterValue = Extract<SymbolicValue, { kind: "Setter" }>;

export type DispatchValue = Extract<SymbolicValue, { kind: "Dispatch" }>;

export type HookResultValue = Extract<SymbolicValue, { kind: "HookResult" }>;

export interface StateUpdate {
  binding: Binding;
  value: SymbolicValue;
  guards: SymbolicValue[];
  isAsync: boolean;
}

export type TransitionTrigger =
  | { kind: "Event"; tag: string; event: string }
  | { kind: "Effect"; hookKind: HookKind; dependencies: string | null };

/**
 * What one event handler or effect does: the bindings it updates and the props it calls.
 */
export interface Transition {
  id: string;
  trigger: TransitionTrigger;
  updates: StateUpdate[];
  delegates: string[];
  loc: SourceLocation;
}

type BailoutReason =
  | "compiler-error"
  | "loop"
  | "unknown-call"
  | "conditional-hook"
  | `untyped-${BindingKind}`;

export interface Bailout {
  reason: BailoutReason;
  message: string;
  loc: SourceLocation;
}

/**
 * Everything the analysis knows about one component.
 */
export interface ComponentAnalysis {
  name: string;
  exportName: string | null;
  displayName: string | null;
  file: string;
  loc: SourceLocation;
  bindings: Binding[];
  placeDomains: Map<string, Domain>;
  render: SymbolicValue;
  transitions: Transition[];
  renders: string[];
  bailouts: Bailout[];
}

export interface Edge {
  transitionId: string;
  targets: number[];
  isAsync: boolean;
}

export interface State {
  assumptions: string[];
  render: SymbolicValue;
  edges: Edge[];
}

export interface DeadBranch {
  decision: Decision;
  side: boolean;
  description: string;
}

/**
 * The reachable states of one component. `places` holds every value each place can take
 * before any decision narrows it.
 */
export interface StateReport {
  places: Map<string, AbstractValue[]>;
  states: State[];
  deadBranches: DeadBranch[];
  isTruncated: boolean;
}

export interface AnalyzedComponent {
  analysis: ComponentAnalysis;
  report: StateReport;
}

export interface ProjectAnalysis {
  components: AnalyzedComponent[];
  fileCount: number;
}
