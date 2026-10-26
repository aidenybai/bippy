import type { HookKind } from "../react-compiler/HIR/ObjectShape";
import type { InstructionId, InstructionValue, SourceLocation } from "../react-compiler/HIR/HIR";

export type { SourceLocation };
import type { PlaceMap } from "./utils/place-map";

export type PrimitiveValue = string | number | boolean | null | undefined;

export type PrimitiveTypeName = "string" | "number" | "bigint" | "boolean";

export type AbstractValue =
  | { kind: "Literal"; value: PrimitiveValue }
  | { kind: "Type"; text: string; primitive: PrimitiveTypeName | null }
  | {
      kind: "Collection";
      collection: "Set" | "Map";
      entries: Array<[PrimitiveValue, PrimitiveValue]>;
    };

export type CollectionContents = Extract<AbstractValue, { kind: "Collection" }>;

export type Truthiness = "truthy" | "falsy" | "either";

export type TestKind = "truthy" | "nullish";

type UnknownTypeReason = "any" | "unknown" | "never" | "unresolved" | "cast";

export type Domain =
  | { kind: "Cases"; cases: AbstractValue[]; origin: "type" | "call-sites" }
  | { kind: "Opaque"; typeText: string }
  | { kind: "Unknown"; reason: UnknownTypeReason };

export type Sample =
  | { kind: "Value"; value: string | number | boolean | null }
  | { kind: "Undefined" }
  | { kind: "Function"; returns: Sample | null }
  | { kind: "Element" }
  | { kind: "Date"; value: string }
  | { kind: "Set"; items: Sample[] }
  | { kind: "Map"; entries: Array<[Sample, Sample]> }
  | { kind: "Promise"; value: Sample }
  | { kind: "Array"; items: Sample[] }
  | { kind: "Object"; fields: Record<string, Sample>; isOpen: boolean };

export type BindingKind =
  | "prop"
  | "state"
  | "reducer"
  | "memo"
  | "context"
  | "hook"
  | "ref"
  | "item"
  | "call"
  | "loop"
  | "suspense"
  | "module";

export interface BindingPlace {
  bindingId: number;
  path: string[];
}

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
  inputPlaces: BindingPlace[];
  lengthLimit: LengthLimit | null;
  derived: DerivedString | DerivedCall | null;
  range: NumberRange | null;
  alias: SymbolicValue | null;
  firstRender?: FirstRenderValue;
}

export interface FirstRenderValue {
  value: SymbolicValue;
  inputIds: number[];
}

export interface NumberRange {
  min: number | null;
  max: number | null;
  inner: SymbolicValue | null;
}

export interface DerivedString {
  method: string;
  receiver: BindingValue;
  argumentValues: PrimitiveValue[];
}

export interface DerivedCall {
  callee: string;
  operands: SymbolicValue[];
}

export interface LengthLimit {
  arrayLength: BindingPlace;
  isSameLength: boolean;
}

export interface Branch {
  terminalId: InstructionId;
  probe: TestKind | "none";
  loc: SourceLocation;
  file: string;
  caseIndex?: number;
}

export interface JsxProp {
  kind: "JsxAttribute";
  name: string;
  value: SymbolicValue;
  handlerId: string | null;
  loc: SourceLocation;
  file: string;
}

export interface JsxSpreadProp {
  kind: "JsxSpreadAttribute";
  value: SymbolicValue;
  handlerId: string | null;
  loc: SourceLocation;
  file: string;
}

export type JsxTag =
  | { kind: "BuiltinTag"; name: string }
  | {
      kind: "Component";
      name: string;
      declaration: string | null;
      isContext: boolean;
      reactExport: string | null;
    }
  | { kind: "DynamicTag"; name: string };

interface SymbolicObjectProperty {
  key: string;
  value: SymbolicValue;
}

export type BinaryOperator = Extract<InstructionValue, { kind: "BinaryExpression" }>["operator"];

export type UnaryOperator = Extract<InstructionValue, { kind: "UnaryExpression" }>["operator"];

export type SymbolicValue =
  | { kind: "Primitive"; value: PrimitiveValue }
  | { kind: "Binding"; binding: Binding; path: string[] }
  | {
      kind: "BinaryExpression";
      operator: BinaryOperator;
      left: SymbolicValue;
      right: SymbolicValue;
    }
  | { kind: "UnaryExpression"; operator: UnaryOperator; value: SymbolicValue }
  | {
      kind: "Conditional";
      test: SymbolicValue;
      testKind: TestKind;
      consequent: SymbolicValue;
      alternate: SymbolicValue;
      branch: Branch;
      guardKeys: string[];
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
  | { kind: "Dispatch"; binding: Binding; reducer: SymbolicValue; pending: Binding | null }
  | { kind: "Bound"; callee: SymbolicValue; argumentValues: SymbolicValue[]; loc: SourceLocation }
  | { kind: "Props" }
  | {
      kind: "HookResult";
      hookKind: HookKind;
      name: string;
      module: string | null;
      argumentValues: SymbolicValue[];
      loc: SourceLocation;
    }
  | { kind: "Global"; name: string; module: string | null }
  | {
      kind: "Collection";
      collection: "Set" | "Map";
      source: SymbolicValue | null;
      isCopy: boolean;
      writes: Array<{ method: string; argumentValues: SymbolicValue[]; guards: SymbolicValue[] }>;
      loc: SourceLocation;
    }
  | { kind: "Unknown"; reason: string; loc: SourceLocation; origin?: UnknownOrigin };

export type UnknownOrigin =
  | { kind: "Name"; name: string }
  | { kind: "Member"; object: SymbolicValue; property: string }
  | { kind: "Call"; callee: SymbolicValue; argumentValues: SymbolicValue[] }
  | { kind: "Settled"; promise: SymbolicValue; outcome: "resolved" | "rejected" }
  | { kind: "Value"; value: SymbolicValue };

export type ConditionalValue = Extract<SymbolicValue, { kind: "Conditional" }>;

export type JsxExpressionValue = Extract<SymbolicValue, { kind: "JsxExpression" }>;

export type JsxContainerValue = Extract<SymbolicValue, { kind: "JsxExpression" | "JsxFragment" }>;

export type BinaryExpressionValue = Extract<SymbolicValue, { kind: "BinaryExpression" }>;

export type BindingValue = Extract<SymbolicValue, { kind: "Binding" }>;

export type GlobalValue = Extract<SymbolicValue, { kind: "Global" }>;

export type CollectionValue = Extract<SymbolicValue, { kind: "Collection" }>;

export type PrimitiveSymbolicValue = Extract<SymbolicValue, { kind: "Primitive" }>;

export type FunctionValue = Extract<SymbolicValue, { kind: "Function" }>;

export type SetterValue = Extract<SymbolicValue, { kind: "Setter" }>;

export type DispatchValue = Extract<SymbolicValue, { kind: "Dispatch" }>;

export type HookResultValue = Extract<SymbolicValue, { kind: "HookResult" }>;

export type ArrayExpressionValue = Extract<SymbolicValue, { kind: "ArrayExpression" }>;

export type ObjectExpressionValue = Extract<SymbolicValue, { kind: "ObjectExpression" }>;

export type WarningKind =
  | "lost-update"
  | "state-mutation"
  | "render-mutation"
  | "prop-mutation"
  | "context-mutation";

export interface Warning {
  kind: WarningKind;
  message: string;
  loc: SourceLocation;
  file: string;
  prop: string | null;
}

export interface StateUpdate {
  binding: Binding;
  value: SymbolicValue;
  guards: SymbolicValue[];
  isAsync: boolean;
  isRepeated?: boolean;
  isMemoized?: boolean;
}

export type HandlerTrigger =
  | { kind: "Event"; tag: string; event: string }
  | {
      kind: "Effect";
      hookKind: HookKind;
      dependencies: string | null;
      dependencyPlaces: BindingPlace[] | null;
    }
  | { kind: "Render" };

export interface Handler {
  id: string;
  trigger: HandlerTrigger;
  updates: StateUpdate[];
  delegates: string[];
  claims: Claim[];
  guards: SymbolicValue[];
  loc: SourceLocation;
}

export type BailoutReason =
  | "compiler-error"
  | "unknown-call"
  | "conditional-hook"
  | "too-complex"
  | "class-component"
  | `untyped-${BindingKind}`;

export interface Bailout {
  reason: BailoutReason;
  message: string;
  loc: SourceLocation;
}

export type StoreFieldValue =
  | { kind: "Argument"; index: number }
  | { kind: "Literal"; value: PrimitiveValue }
  | { kind: "Toggle" }
  | { kind: "Unknown" };

export interface StoreAssignment {
  field: string;
  value: StoreFieldValue;
}

export interface StoreActions extends Map<string, StoreAssignment[]> {}

export interface StoreModel {
  actions: StoreActions;
  initial: SymbolicValue;
}

export interface ProvidedContext {
  contextKey: string;
  value: SymbolicValue;
}

export interface ContextSetterFields extends Map<string, Map<string, string>> {}

export interface ComponentAnalysis {
  name: string;
  exportName: string | null;
  runtimeName: string | null;
  file: string;
  declaration: string;
  loc: SourceLocation;
  isAsync: boolean;
  isStrictNullChecks: boolean;
  bindings: Binding[];
  wholePropsSample: Sample | null;
  decidedBranchOutcomes: Map<string, boolean[]>;
  providedContexts: ProvidedContext[];
  contextSamples: Map<string, Sample>;
  untypedContextBindingIds: Map<string, number>;
  placeDomains: PlaceMap<Domain>;
  unionMemberValues: PlaceMap<AbstractValue[][]>;
  render: SymbolicValue;
  localRenders: SymbolicValue[];
  handlers: Handler[];
  renders: string[];
  claims: Claim[];
  bailouts: Bailout[];
  warnings: Warning[];
}

export type ClaimKind = "cast" | "non-null" | "invariant" | "state";

export interface Claim {
  kind: ClaimKind;
  subject: SymbolicValue;
  cases: AbstractValue[] | null;
  test: SymbolicValue | null;
  guards: SymbolicValue[];
  description: string;
  loc: SourceLocation;
}

export type ClaimVerdict = "holds" | "broken" | "unproven";

export interface ClaimOutcome {
  claim: Claim;
  verdict: ClaimVerdict;
  stateIndex: number | null;
  path: string[];
  reason: string | null;
}

export interface Transition {
  handlerId: string;
  targets: number[];
  isAsync: boolean;
}

export interface State {
  regionIndex: number;
  conditions: string[];
  render: SymbolicValue;
  fragments: SymbolicValue[];
  transitions: Transition[];
}

export interface Region {
  placeNames: string[];
  bindingIds: number[];
  states: number[];
  firstRenderState: number | null;
  possibleFirstRenderStates: number[];
  isTruncated: boolean;
}

export interface UnreachableBranch {
  branch: Branch;
  isTrueSide: boolean;
  description: string;
}

export interface StateReport {
  places: PlaceMap<AbstractValue[]>;
  states: State[];
  regions: Region[];
  unreachableBranches: UnreachableBranch[];
  claimOutcomes: ClaimOutcome[];
  isTruncated: boolean;
}

export interface PropLink {
  name: string;
  value: SymbolicValue;
  domain: Domain;
}

export interface ComponentLink {
  parent: string;
  child: string;
  loc: SourceLocation;
  file: string;
  props: PropLink[];
  isComplete: boolean;
}

export interface ComponentInstance {
  link: ComponentLink;
  report: StateReport;
}

export interface AnalyzedComponent {
  analysis: ComponentAnalysis;
  report: StateReport;
  links: ComponentLink[];
  instances: ComponentInstance[];
}

export interface ProjectAnalysis {
  components: AnalyzedComponent[];
  fileCount: number;
}
