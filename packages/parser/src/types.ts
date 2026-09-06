import type {
  ArrowFunctionExpression,
  BindingPattern,
  Class,
  Expression,
  Function as FunctionNode,
  Program,
  Span,
} from "oxc-parser";
import type { HostTextTag, WorkTag } from "./work-tags.js";

export type SourceLanguage = "js" | "jsx" | "ts" | "tsx";

export interface SourceLocation {
  filePath: string;
  line: number;
  column: number;
}

export interface ParsedSourceFile {
  filePath: string;
  lang: SourceLanguage;
  sourceText: string;
  program: Program;
  lineStarts: number[];
  errors: string[];
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  location: SourceLocation | null;
}

export type ImportedName =
  | { kind: "default" }
  | { kind: "namespace" }
  | { kind: "named"; name: string };

export interface ImportBinding {
  localName: string;
  imported: ImportedName;
  specifier: string;
  isTypeOnly: boolean;
  span: Span;
}

export interface ExportedLocal {
  kind: "local";
  exportedName: string;
  localName: string;
}

export interface ExportedExpression {
  kind: "expression";
  exportedName: string;
  expression: Expression;
}

export interface ReExport {
  kind: "re-export";
  exportedName: string;
  imported: ImportedName;
  specifier: string;
}

export interface ReExportAll {
  kind: "re-export-all";
  specifier: string;
}

export type ExportEntry = ExportedLocal | ExportedExpression | ReExport | ReExportAll;

export type FunctionLikeNode = FunctionNode | ArrowFunctionExpression;

export type TopLevelBinding =
  | {
      kind: "variable";
      name: string;
      init: Expression | null;
      declarationKind: "const" | "let" | "var" | "using" | "await using";
      span: Span;
    }
  | { kind: "function"; name: string; node: FunctionNode; span: Span }
  | { kind: "class"; name: string; node: Class; span: Span }
  | { kind: "import"; name: string; binding: ImportBinding; span: Span }
  | {
      kind: "destructured";
      name: string;
      pattern: BindingPattern;
      init: Expression | null;
      span: Span;
    };

export interface MemberAssignment {
  objectName: string;
  propertyName: string;
  value: Expression;
  span: Span;
}

export interface ModuleRecord {
  filePath: string;
  file: ParsedSourceFile;
  /** Leading string directives such as `"use client"` or `"use strict"`. */
  directives: string[];
  imports: ImportBinding[];
  exports: ExportEntry[];
  bindings: Map<string, TopLevelBinding>;
  memberAssignments: MemberAssignment[];
}

export type ModuleResolution =
  | { kind: "internal"; filePath: string }
  | { kind: "external"; packageName: string; filePath: string | null }
  | { kind: "builtin"; specifier: string }
  | { kind: "unresolved"; specifier: string; error: string };

export type ResolvedSymbol =
  | { kind: "binding"; module: ModuleRecord; binding: TopLevelBinding }
  | { kind: "expression"; module: ModuleRecord; expression: Expression }
  | { kind: "namespace"; module: ModuleRecord }
  | { kind: "external"; packageName: string; imported: ImportedName; specifier: string }
  | { kind: "unresolved"; reason: string };

export interface ComponentDefinition {
  /** Function/class name or the binding it was assigned to; null for anonymous components. */
  name: string | null;
  module: ModuleRecord;
  node: FunctionLikeNode | Class;
  scope: Scope;
  isClass: boolean;
  properties: Map<string, StaticValue>;
}

export interface ContextDefinition {
  /** Inferred from the binding the context was assigned to; used for notes only. */
  name: string;
  /** Explicit `Context.displayName`; React names provider/consumer fibers from it. */
  displayName: string | null;
  defaultValue: StaticValue;
  location: SourceLocation | null;
}

export type StaticElementType =
  | { kind: "host"; tagName: string }
  | { kind: "function"; component: ComponentDefinition }
  | { kind: "class"; component: ComponentDefinition }
  | { kind: "memo"; inner: StaticElementType; hasCompare: boolean; displayName: string | null }
  | { kind: "forward-ref"; component: ComponentDefinition; displayName: string | null }
  | { kind: "lazy"; inner: StaticElementType | null; displayName: string | null }
  | { kind: "fragment" }
  | { kind: "strict-mode" }
  | { kind: "profiler" }
  | { kind: "suspense" }
  | { kind: "suspense-list" }
  | { kind: "activity" }
  | { kind: "view-transition" }
  | { kind: "context-provider"; context: ContextDefinition | null; displayName: string | null }
  | { kind: "context-consumer"; context: ContextDefinition | null; displayName: string | null }
  | { kind: "portal" }
  | { kind: "external"; packageName: string; importedName: string; displayName: string }
  | { kind: "stub"; stub: StubComponent }
  | { kind: "unknown"; displayName: string | null; reason: string };

/**
 * A library component modeled by the harness rather than analyzed from source
 * (e.g. a router's `Outlet` yielding the matched child route). It renders as a
 * function-component fiber whose children are whatever `render` returns.
 */
export interface StubComponent {
  displayName: string;
  /** Work tag of the real component (e.g. `ForwardRef` for `Link`); defaults to a function component. */
  tag?: WorkTag;
  render: (props: StaticObjectValue, tools: StubRenderTools) => StaticValue;
}

export interface StubRenderTools {
  /** Reads a context value as `useContext` would from the stub's position in the tree. */
  readContext: (context: ContextDefinition) => StaticValue;
}

/** Supplies static values for named imports from external packages; return null to keep the import opaque. */
export type ExternalValueProvider = (
  packageName: string,
  importedName: string,
) => StaticValue | null;

export type StaticPrimitive = string | number | boolean | null | undefined | bigint;

export type StaticObjectEntry =
  | { kind: "property"; key: string; value: StaticValue }
  | { kind: "spread"; value: StaticValue };

export interface StaticObjectValue {
  kind: "object";
  entries: StaticObjectEntry[];
}

/**
 * Where an element was created under React Server Components. Server-created
 * elements whose type is a server component render on the server and produce no
 * client fiber; null when the program is not analyzed with RSC semantics or the
 * element was created at module scope.
 */
export type RenderEnvironment = "server" | "client";

export interface StaticElementValue {
  kind: "element";
  type: StaticElementType;
  key: StaticValue | null;
  props: StaticObjectValue;
  location: SourceLocation | null;
  environment: RenderEnvironment | null;
}

export interface StaticPrimitiveValue {
  kind: "primitive";
  value: StaticPrimitive;
}

export type UnknownPrimitiveType = "string" | "number" | "boolean" | "any";

export interface StaticUnknownPrimitiveValue {
  kind: "unknown-primitive";
  primitiveType: UnknownPrimitiveType;
  reason: string;
}

export interface StaticListValue {
  kind: "list";
  items: StaticValue[];
}

export interface StaticRepeatValue {
  kind: "repeat";
  item: StaticValue;
  location: SourceLocation | null;
}

export interface StaticBranchValue {
  kind: "branch";
  alternatives: StaticValue[];
  preferredIndex: number;
  reason: string;
  location: SourceLocation | null;
}

export interface StaticFunctionValue {
  kind: "function";
  node: FunctionLikeNode;
  scope: Scope;
  module: ModuleRecord;
  thisValue: StaticValue | null;
  name: string | null;
  properties: Map<string, StaticValue>;
}

export interface StaticClassValue {
  kind: "class";
  node: Class;
  scope: Scope;
  module: ModuleRecord;
  name: string | null;
  properties: Map<string, StaticValue>;
}

export interface StaticComponentReferenceValue {
  kind: "component-reference";
  type: StaticElementType;
}

export interface StaticContextValue {
  kind: "context";
  context: ContextDefinition;
}

export interface StaticReactApiValue {
  kind: "react-api";
  api: ReactApi;
}

export interface StaticExternalValue {
  kind: "external";
  packageName: string;
  importedName: string;
}

export interface StaticNamespaceValue {
  kind: "namespace";
  module: ModuleRecord;
}

export interface StaticGlobalValue {
  kind: "global";
  name: string;
}

export interface StaticMethodValue {
  kind: "method";
  receiver: StaticValue;
  name: string;
}

export interface StaticUnknownValue {
  kind: "unknown";
  reason: string;
  location: SourceLocation | null;
}

/**
 * A function modeled by the analyzer itself (framework hooks, router
 * factories). `call` receives the statically evaluated arguments and the same
 * context tools a stub component gets, so modeled hooks can read providers.
 */
export interface StaticNativeFunctionValue {
  kind: "native-function";
  name: string;
  call: (args: StaticValue[], tools: StubRenderTools) => StaticValue;
}

export type StaticValue =
  | StaticElementValue
  | StaticPrimitiveValue
  | StaticUnknownPrimitiveValue
  | StaticListValue
  | StaticRepeatValue
  | StaticBranchValue
  | StaticObjectValue
  | StaticFunctionValue
  | StaticClassValue
  | StaticComponentReferenceValue
  | StaticContextValue
  | StaticReactApiValue
  | StaticExternalValue
  | StaticNamespaceValue
  | StaticGlobalValue
  | StaticMethodValue
  | StaticNativeFunctionValue
  | StaticUnknownValue;

export type ReactApi =
  | "memo"
  | "forwardRef"
  | "lazy"
  | "createContext"
  | "createElement"
  | "cloneElement"
  | "isValidElement"
  | "Children"
  | "Children.map"
  | "Children.forEach"
  | "Children.count"
  | "Children.only"
  | "Children.toArray"
  | "Fragment"
  | "StrictMode"
  | "Suspense"
  | "SuspenseList"
  | "Profiler"
  | "Activity"
  | "ViewTransition"
  | "Component"
  | "PureComponent"
  | "useState"
  | "useReducer"
  | "useMemo"
  | "useCallback"
  | "useRef"
  | "useContext"
  | "use"
  | "useEffect"
  | "useLayoutEffect"
  | "useInsertionEffect"
  | "useImperativeHandle"
  | "useDebugValue"
  | "useId"
  | "useTransition"
  | "useDeferredValue"
  | "useSyncExternalStore"
  | "useOptimistic"
  | "useActionState"
  | "startTransition"
  | "createPortal"
  | "flushSync"
  | "createRoot"
  | "hydrateRoot"
  | "render"
  | "hydrate"
  | "jsx"
  | "jsxs"
  | "jsxDEV";

export interface Scope {
  parent: Scope | null;
  bindings: Map<string, StaticValue>;
}

export type StaticFiberKind = "fiber" | "text" | "branch" | "repeat" | "opaque" | "unknown";

export interface StaticFiberBase {
  id: number;
  kind: StaticFiberKind;
  return: StaticFiber | null;
  sibling: StaticFiber | null;
  index: number;
  location: SourceLocation | null;
}

export interface StaticElementFiber extends StaticFiberBase {
  kind: "fiber";
  tag: WorkTag;
  type: StaticElementType;
  elementType: StaticElementType;
  displayName: string | null;
  key: string | null;
  props: StaticObjectValue;
  child: StaticFiber | null;
  notes: string[];
}

export interface StaticTextFiber extends StaticFiberBase {
  kind: "text";
  tag: typeof HostTextTag;
  text: string | null;
}

export interface StaticBranchFiber extends StaticFiberBase {
  kind: "branch";
  alternatives: Array<StaticFiber | null>;
  preferredIndex: number;
  reason: string;
}

export interface StaticRepeatFiber extends StaticFiberBase {
  kind: "repeat";
  child: StaticFiber | null;
}

export interface StaticOpaqueFiber extends StaticFiberBase {
  kind: "opaque";
  displayName: string;
  packageName: string | null;
  key: string | null;
  props: StaticObjectValue;
  passedChildren: StaticFiber | null;
  reason: string;
}

export interface StaticUnknownFiber extends StaticFiberBase {
  kind: "unknown";
  reason: string;
}

export type StaticFiber =
  | StaticElementFiber
  | StaticTextFiber
  | StaticBranchFiber
  | StaticRepeatFiber
  | StaticOpaqueFiber
  | StaticUnknownFiber;

export interface StaticRenderStats {
  fiberCount: number;
  textCount: number;
  branchCount: number;
  repeatCount: number;
  opaqueCount: number;
  unknownCount: number;
  modulesLoaded: number;
}

export interface StaticRenderResult {
  root: StaticElementFiber;
  diagnostics: Diagnostic[];
  stats: StaticRenderStats;
}

export interface StaticRendererOptions {
  rootDirectory: string;
  tsconfigPath?: string;
  conditionNames?: string[];
  maxComponentDepth?: number;
  maxFiberCount?: number;
  maxRecursionPerComponent?: number;
  maxCallDepth?: number;
  maxSteps?: number;
  resolveExternalPackages?: boolean;
  externalPackageAllowList?: string[];
  supportsSingletons?: boolean;
  /** Apply React Server Components semantics: components outside `"use client"` modules render without a fiber. */
  serverComponents?: boolean;
  externalValues?: ExternalValueProvider;
}
