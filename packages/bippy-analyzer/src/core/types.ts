import type { HookKind } from "../react-compiler/HIR/ObjectShape.js";
import type { InstructionId, SourceLocation } from "../react-compiler/HIR/HIR.js";

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
 * How a branch reads its test: `truthy` branches on the value itself, `nullish` on
 * whether it is `!= null`.
 */
export type TestKind = "truthy" | "nullish";

type UnknownTypeReason = "any" | "unknown" | "never" | "unresolved" | "cast";

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
  | { kind: "Function"; returns: Sample | null }
  | { kind: "Element" }
  | { kind: "Date"; value: string }
  | { kind: "Promise"; value: Sample }
  | { kind: "Array"; items: Sample[] }
  | { kind: "Object"; fields: Record<string, Sample>; isOpen: boolean };

export type BindingKind =
  | "prop"
  | "state"
  | "reducer"
  | "context"
  | "hook"
  | "ref"
  | "item"
  | "call"
  | "suspense";

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
  /** The places a call result's arguments read, which its value may depend on. */
  inputs: string[];
}

/**
 * Where a branch came from: the terminal that branches, how its test is checked at
 * runtime, and the location of the test expression.
 */
export interface Branch {
  terminalId: InstructionId;
  probe: TestKind | "none";
  loc: SourceLocation;
  /** The file the branch is in, the component's own or a hook's it calls. */
  file: string;
}

export interface JsxProp {
  kind: "JsxAttribute";
  name: string;
  value: SymbolicValue;
  handlerId: string | null;
}

/**
 * Props spread onto an element. When what they hold isn't known, like `{...register("name")}`,
 * they may install any handler, which `handlerId` stands for.
 */
export interface JsxSpreadProp {
  kind: "JsxSpreadAttribute";
  value: SymbolicValue;
  handlerId: string | null;
}

/**
 * A JSX tag. A component tag records where its component is declared, as
 * `<file>#<name>`, when the checker can resolve it, and whether it is a context, which React
 * 19 renders as its provider. A dynamic tag is one the analysis can't
 * name, like `` `h${level}` ``.
 */
export type JsxTag =
  | { kind: "BuiltinTag"; name: string }
  | { kind: "Component"; name: string; declaration: string | null; isContext: boolean }
  | { kind: "DynamicTag"; name: string };

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
      branch: Branch;
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
  | {
      kind: "HookResult";
      hookKind: HookKind;
      name: string;
      args: SymbolicValue[];
      loc: SourceLocation;
    }
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

export type WarningKind = "lost-update" | "state-mutation" | "render-mutation" | "prop-mutation";

/**
 * A mutation the compiler's effects prove, which React won't render as written.
 */
export interface Warning {
  kind: WarningKind;
  message: string;
  loc: SourceLocation;
  file: string;
}

export interface StateUpdate {
  binding: Binding;
  value: SymbolicValue;
  guards: SymbolicValue[];
  isAsync: boolean;
}

export type HandlerTrigger =
  | { kind: "Event"; tag: string; event: string }
  | { kind: "Effect"; hookKind: HookKind; dependencies: string | null };

/**
 * What one event handler or effect does: the bindings it updates and the props it calls.
 */
export interface Handler {
  id: string;
  trigger: HandlerTrigger;
  updates: StateUpdate[];
  delegates: string[];
  loc: SourceLocation;
}

export type BailoutReason =
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
export type StoreFieldValue =
  | { kind: "Argument"; index: number }
  | { kind: "Literal"; value: PrimitiveValue }
  | { kind: "Toggle" }
  | { kind: "Unknown" };

export interface StoreAssignment {
  field: string;
  value: StoreFieldValue;
}

/** What each action of a store sets, by the action's name. */
export type StoreModel = Map<string, StoreAssignment[]>;

export interface ProvidedContext {
  contextKey: string;
  value: SymbolicValue;
}

/**
 * What the providers of a context put in it: for each setter field, like `setOpen`, the
 * state field it sets, like `open`.
 */
export type ContextModels = Map<string, Map<string, string>>;

export interface ComponentAnalysis {
  name: string;
  exportName: string | null;
  /** The name React shows for it, or null when a `displayName` is set at runtime. */
  runtimeName: string | null;
  file: string;
  declaration: string;
  loc: SourceLocation;
  /** An `async` component, which renders only on a server. */
  isAsync: boolean;
  bindings: Binding[];
  /** A sample of the whole props object, when the component passes it on whole. */
  propsSample: Sample | null;
  /** The values the component provides to contexts, by each context's declaration key. */
  providedContexts: ProvidedContext[];
  /** A sample of the value each context the component reads holds, by declaration key. */
  contextSamples: Map<string, Sample>;
  /** The binding an untyped context is read through, by declaration key. */
  untypedContexts: Map<string, number>;
  placeDomains: Map<string, Domain>;
  render: SymbolicValue;
  /** The guards each branch's value was computed under, as formatted keys. */
  branchGuards: WeakMap<ConditionalValue, string[]>;
  handlers: Handler[];
  renders: string[];
  bailouts: Bailout[];
  warnings: Warning[];
}

export interface Transition {
  handlerId: string;
  targets: number[];
  isAsync: boolean;
}

/**
 * One state of a region. `render` decides only the region's own branches and leaves every
 * other region's undecided. `fragments` are what the region's outermost branches render.
 */
export interface State {
  region: number;
  conditions: string[];
  render: SymbolicValue;
  fragments: SymbolicValue[];
  transitions: Transition[];
}

/**
 * Branches that depend on each other: their tests read overlapping places, or one sits in
 * the other's arm. Groups vary independently, so the component's screens are every
 * combination of one state from each region.
 */
export interface Region {
  places: string[];
  bindingIds: number[];
  states: number[];
}

export interface UnreachableBranch {
  branch: Branch;
  side: boolean;
  description: string;
}

/**
 * The reachable states of one component. `places` holds every value each place can take
 * before any branch narrows it.
 */
export interface StateReport {
  places: Map<string, AbstractValue[]>;
  states: State[];
  regions: Region[];
  unreachableBranches: UnreachableBranch[];
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
