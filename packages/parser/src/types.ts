import type {
  ArrowFunctionExpression,
  BindingPattern,
  Class,
  Expression,
  Function as FunctionNode,
  Program,
  Span,
  Statement,
} from "oxc-parser";
import type { TypeScriptDeclaration } from "./evaluate/typescript-declarations.js";
import type { RuntimeSnapshot } from "./harness/snapshot.js";
import type { WorkTag } from "./work-tags.js";

export type SourceLanguage = "js" | "jsx" | "ts" | "tsx" | "json";

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
  | { kind: "typescript"; name: string; node: TypeScriptDeclaration; span: Span }
  | { kind: "import"; name: string; binding: ImportBinding; span: Span }
  | {
      kind: "destructured";
      name: string;
      pattern: BindingPattern;
      init: Expression | null;
      span: Span;
    };

export interface ModuleRecord {
  filePath: string;
  file: ParsedSourceFile;
  /** Leading string directives such as `"use client"` or `"use strict"`. */
  directives: string[];
  imports: ImportBinding[];
  exports: ExportEntry[];
  bindings: Map<string, TopLevelBinding>;
  /** Specifiers of static `import`/`export ... from` declarations, in source order. */
  dependencies: string[];
  /** Top-level statements that run when the module is evaluated (`X.displayName = ...`, `registry.set(...)`). */
  sideEffectStatements: Statement[];
  /** Exports were collected from `exports.x = ` / `module.exports` assignments rather than ESM syntax. */
  isCommonJs: boolean;
  /** `module.exports = value` replaced the exports object, so `require()` yields the `default` export. */
  replacesModuleExports: boolean;
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
  /** The function, class, or (for a compiler-lowered class) the wrapper that produced it. */
  node: FunctionLikeNode | Class;
  scope: Scope;
  /** Present for class components. */
  classBody: ClassBody | null;
  properties: Map<string, StaticValue>;
}

export interface ClassMemberBase {
  key: string;
  isStatic: boolean;
}

export interface ClassFunctionMember extends ClassMemberBase {
  kind: "constructor" | "method" | "getter";
  functionNode: FunctionLikeNode;
}

export interface ClassFieldMember extends ClassMemberBase {
  kind: "field";
  value: Expression | null;
}

export type ClassMember = ClassFunctionMember | ClassFieldMember;

/**
 * What a class declares, independent of whether it was written with class
 * syntax or lowered by a compiler into a constructor function with prototype
 * assignments.
 */
export interface ClassBody {
  members: ClassMember[];
  superValue: StaticValue | null;
}

/** What `super` refers to inside a class member. */
export interface SuperBinding {
  /** `super(...)` inside a derived constructor; null elsewhere. */
  construct: ((args: StaticValue[]) => void) | null;
  /** The class `super.member` reads from; null for a base class. */
  parent: StaticValue | null;
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
  | ({ kind: "memo"; inner: StaticElementType; hasCompare: boolean } & WrapperElementType)
  | ({ kind: "forward-ref"; component: ComponentDefinition } & WrapperElementType)
  | ({ kind: "lazy"; inner: StaticElementType | null } & WrapperElementType)
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

/** `React.memo`/`forwardRef`/`lazy` objects: statics assigned to them (`Button.__radixId = ...`) live on the object. */
export interface WrapperElementType {
  displayName: string | null;
  properties: Map<string, StaticValue>;
}

/**
 * A library component modeled by the harness rather than analyzed from source
 * (e.g. a router's `Outlet` yielding the matched child route). It renders as a
 * function-component fiber whose children are whatever `render` returns.
 */
export interface StubComponent {
  /** null for components React itself would report anonymously (e.g. an unnamed `forwardRef`). */
  displayName: string | null;
  /** Work tag of the real component (e.g. `ForwardRef` for `Link`); defaults to a function component. */
  tag?: WorkTag;
  /** Statics the library hangs on the component (`Styled.withComponent`). */
  properties?: ReadonlyMap<string, StaticValue>;
  render: (props: StaticObjectValue, tools: StubRenderTools) => StaticValue;
  /**
   * For build-time macros (Lingui's `<Trans>`): the props of the element the
   * transform emits for `<Stub {...props}>children</Stub>`, given the children
   * as written. The element's `children` are what the macro produces, not `props`.
   */
  expandJsx?: (props: StaticObjectValue, children: MacroJsxChild[]) => StaticObjectValue;
}

/** A JSX child as a build-time macro sees it: its value together with how it was written. */
export interface MacroJsxChild {
  value: StaticValue;
  source: MacroJsxChildSource;
}

export type MacroJsxChildSource =
  | { kind: "text" }
  | { kind: "identifier"; name: string }
  /** `children` is null when the element's children could not be paired with their source. */
  | { kind: "element"; children: MacroJsxChild[] | null }
  | { kind: "expression" };

export interface StubRenderTools {
  /** Reads a context value as `useContext` would from the stub's position in the tree. */
  readContext: (context: ContextDefinition) => StaticValue;
  /** Calls a function whose promise the framework awaits (route `lazy`), with `await x` read as `x`. */
  callAwaited: (callee: StaticValue, args: StaticValue[]) => StaticValue;
  call: (callee: StaticValue, args: StaticValue[]) => StaticValue;
  /** A value recorded from the running page, with references to the project's module exports evaluated. */
  captured: (captured: CapturedValue, name: string) => StaticValue;
  /** Records that `value` reached code the analysis cannot see, so its later mutations are uncertain. */
  markEscaped: (value: StaticValue) => void;
  /** Binding the call's result is assigned to, as build-time labelers (Emotion's babel/swc plugin) see it. */
  nameHint: string | null;
  /** For tagged templates, the identifier each `${expression}` is (null when not a bare identifier); null for other calls. */
  templateArgumentNames: Array<string | null> | null;
}

/**
 * Supplies static values for imports from external packages. `specifier` is the
 * import source as written (`next/link`, `react-router/dom`); `importedName` is
 * the binding (`default`, `*`, or the named export). Return null to keep the
 * import opaque.
 */
export interface ExternalValueProvider {
  (specifier: string, importedName: string): StaticValue | null;
}

/** What a library model may learn about the analyzed project: which transforms shaped the runtime, and what the running page held. */
export interface ProjectContext {
  /** Directory the analyzed app is served from (`process.cwd()` of its dev server); `null` when analyzing loose modules. */
  rootDirectory: string | null;
  hasDeclaredDependency: (packageName: string) => boolean;
  /** The text the dev server serves for a same-origin or root-relative URL from the project's static directory; `null` when it serves none. */
  readServedAsset: (url: string) => string | null;
  /** The captured TanStack Query cache entry for a query hash (`hashKey(queryKey)`), if the page held one. */
  findQuery: (queryHash: string) => CapturedQuery | null;
  /** Captured mutations for a mutation key hash (`null` for keyless mutations); `null` when the mutation cache was not recorded. */
  findMutations: (mutationHash: string | null) => CapturedMutation[] | null;
  /** The Lingui catalog the page had active; `null` when no `I18nProvider` was recorded. */
  linguiCatalog: CapturedLinguiCatalog | null;
  /** The data-router state the page settled on; `null` when no React Router data router was recorded. */
  routerState: CapturedRouterState | null;
  /** The state of each Redux store the page created; `null` when no store was recorded. */
  storeStates: readonly CapturedValue[] | null;
}

export interface LibraryValueProvider {
  (specifier: string, importedName: string, project: ProjectContext): StaticValue | null;
}

/** Export names a library model covers, keyed by the import specifier they are imported from. */
export interface ModeledExports {
  readonly [specifier: string]: readonly string[];
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * A runtime value serialized from the page: JSON, except that nodes JSON cannot
 * carry are replaced by an opaque marker object (see `observations.ts`) so the
 * rest of the structure stays known, and nodes identical to a loaded module's
 * export are replaced by a reference to that export. Absent (`undefined`)
 * values are omitted.
 */
export type CapturedValue = JsonValue;

/** A module export the page held: `module` is the URL path the dev server served the module at. */
export interface CapturedExportReference {
  module: string;
  name: string;
}

/** One entry of a TanStack Query cache (`Query.state`) as it stood when the page was captured. */
export interface CapturedQuery {
  queryHash: string;
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
  data?: CapturedValue;
  error: CapturedValue;
  dataUpdateCount: number;
  dataUpdatedAt: number;
  errorUpdateCount: number;
  errorUpdatedAt: number;
  fetchFailureCount: number;
  fetchFailureReason: CapturedValue;
  isInvalidated: boolean;
  /** `Query.isStale()` at capture, which folds in the observers' `staleTime`. */
  isStale: boolean;
}

/** One entry of a TanStack mutation cache (`Mutation.state`); a mutation only enters the cache once `mutate` ran. */
export interface CapturedMutation {
  mutationHash: string | null;
  status: "idle" | "pending" | "success" | "error";
  data?: CapturedValue;
  error: CapturedValue;
  variables?: CapturedValue;
  context?: CapturedValue;
  failureCount: number;
  failureReason: CapturedValue;
  isPaused: boolean;
  submittedAt: number;
}

/** Both TanStack caches of every mounted `QueryClient`. */
export interface CapturedQueryCaches {
  queries: CapturedQuery[];
  mutations: CapturedMutation[];
}

/** The compiled catalog of the active locale, as `i18n.messages` of the mounted Lingui `I18nProvider`. */
export interface CapturedLinguiCatalog {
  locale: string;
  messages: Record<string, CapturedValue>;
}

export interface CapturedRouteMatch {
  id: string;
  pathname: string;
  params: Record<string, string>;
}

export interface CapturedLocation {
  pathname: string;
  search: string;
  hash: string;
}

/** React Router's `DataRouterStateContext` value once the page settled. */
export interface CapturedRouterState {
  location: CapturedLocation;
  matches: CapturedRouteMatch[];
  loaderData: Record<string, CapturedValue>;
  navigationState: "idle" | "loading" | "submitting";
  revalidationState: "idle" | "loading";
}

/** What the harness reads off the live roots besides the fiber tree: library state the page's code reads at render. */
export interface RootObservations extends CapturedQueryCaches {
  lingui?: CapturedLinguiCatalog;
  router?: CapturedRouterState;
  /** `getState()` of every Redux store the page created (react-redux providers, kea's store), once settled. */
  stores?: CapturedValue[];
}

/** The origin's persisted state (`document.cookie`, Web Storage) as the settled page held it. */
export interface CapturedPageState {
  cookie: string;
  /** `window.name`; absent in captures taken before it was recorded. */
  name?: string;
  /** `history.state` before the page's first script ran; absent in captures taken before it was recorded. */
  historyState?: CapturedValue;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

/** The environment the server process ran with, whole: unlisted variables are unset. */
export interface ProcessEnvironment {
  variables: Record<string, string>;
  /** Prefix of the variables client bundles inline; the rest read `undefined` in the browser. */
  clientPrefix: string | null;
}

/** The document request the server rendered for, as the browser sent it. */
export interface CapturedRequest {
  headers: Record<string, string>;
}

/** What the running page held that its code reads at render: inputs the static render takes as given. */
export interface RuntimeObservations {
  /** `window` properties recorded whole (bootstrap payloads); nested objects are complete, so unlisted keys are `undefined`. */
  globals: Record<string, CapturedValue>;
  queries: CapturedQuery[];
  /** Absent in captures that predate mutation recording, which then stays uncertain. */
  mutations?: CapturedMutation[];
  lingui?: CapturedLinguiCatalog;
  router?: CapturedRouterState;
  stores?: CapturedValue[];
  /** Absent in captures that predate page-state recording, which then assume a fresh profile. */
  page?: CapturedPageState;
  /** Absent in captures that predate request recording, which then leave request headers uncertain. */
  request?: CapturedRequest;
}

export type StaticPrimitive = string | number | boolean | null | undefined | bigint;

/** A `get`/`set` pair; a read runs the getter and an assignment runs the setter. */
export interface StaticAccessor {
  get: StaticValue | null;
  set: StaticValue | null;
}

/** An accessor entry's `value` is the uncertain stand-in helpers see without calling the getter. */
export type StaticObjectEntry =
  | { kind: "property"; key: string; value: StaticValue; accessor?: StaticAccessor }
  | { kind: "spread"; value: StaticValue };

/** `constructedBy` is the class whose `new` produced the object, so `instanceof` and its prototype resolve. */
export interface StaticObjectValue {
  kind: "object";
  entries: StaticObjectEntry[];
  /** Identifies the allocation; values constructed without one have undecidable identity. */
  allocation?: symbol;
  constructedBy?: StaticClassValue;
  /** Created with `Object.create(null)`: no inherited `constructor` or `Object.prototype` methods. */
  hasNullPrototype?: boolean;
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

/** Ordering a clock-derived number carries; see `evaluate/timers.ts`. */
export type ClockOrdering = "reading" | "settled" | "unbounded";

/** Leading characters of an unknown string and, when fixed, its length; see `evaluate/primitive-shapes.ts`. */
export interface StringShape {
  prefix: string;
  length: number | null;
}

/** Inclusive bounds of an unknown number. */
export interface NumberRange {
  min: number;
  max: number;
}

export interface StaticUnknownPrimitiveValue {
  kind: "unknown-primitive";
  primitiveType: UnknownPrimitiveType;
  reason: string;
  clock?: ClockOrdering;
  stringShape?: StringShape;
  numberRange?: NumberRange;
}

export interface StaticListValue {
  kind: "list";
  items: StaticValue[];
  allocation?: symbol;
  /** Named properties an array carries besides its indices, like `index` on a match. */
  properties?: ReadonlyMap<string, StaticValue>;
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
  superBinding: SuperBinding | null;
  name: string | null;
  properties: Map<string, StaticValue>;
  boundArgs?: StaticValue[];
  boundThis?: StaticValue;
}

export interface StaticClassValue {
  kind: "class";
  node: Class | FunctionLikeNode;
  body: ClassBody;
  scope: Scope;
  module: ModuleRecord;
  name: string | null;
  properties: Map<string, StaticValue>;
}

/** A list item (or child) that is present on some paths and absent on others, as `filter` produces. */
export interface StaticOptionalValue {
  kind: "optional";
  value: StaticValue;
  reason: string;
  location: SourceLocation | null;
}

export interface StaticRegExpValue {
  kind: "regexp";
  pattern: string;
  flags: string;
  lastIndex: number;
}

/** A `Symbol.for(key)` registry symbol; unregistered symbols stay unknown. */
export interface StaticSymbolValue {
  kind: "symbol";
  key: string;
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
  /**
   * True when the value was produced by calling or reading a member of an
   * external binding (`useQuery()`, `api.error`); such values have unknown
   * truthiness, whereas the import binding itself is defined.
   */
  derived: boolean;
}

export interface StaticNamespaceValue {
  kind: "namespace";
  module: ModuleRecord;
}

export interface StaticGlobalValue {
  kind: "global";
  name: string;
}

/** A DOM node handed to a ref once React committed the host element; one value per node so identity comparisons hold. */
export interface StaticHostNodeValue {
  kind: "host-node";
  tagName: string;
}

/** A `Date` (or similar immutable-by-convention instance) produced by native code from wholly known inputs; its pure methods run natively. */
export interface StaticNativeObjectValue {
  kind: "native-object";
  value: object;
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
  /** The path throws this value, which a `catch` or an error boundary above may receive. */
  thrown?: StaticValue;
}

/**
 * A function modeled by the analyzer itself (framework hooks, router
 * factories). `call` receives the statically evaluated arguments and the same
 * context tools a stub component gets, so modeled hooks can read providers.
 */
/** `new Proxy(target, handler)`: traps run through the interpreter on access, call, and construction. */
export interface StaticProxyValue {
  kind: "proxy";
  target: StaticValue;
  handler: StaticObjectValue;
}

export interface StaticNativeFunctionValue {
  kind: "native-function";
  name: string;
  call: (args: StaticValue[], tools: StubRenderTools) => StaticValue;
  /** Invoked when the value flows into code the evaluator does not follow. */
  onEscape?: () => void;
}

export type StaticValue =
  | StaticElementValue
  | StaticPrimitiveValue
  | StaticUnknownPrimitiveValue
  | StaticListValue
  | StaticRepeatValue
  | StaticBranchValue
  | StaticOptionalValue
  | StaticObjectValue
  | StaticFunctionValue
  | StaticClassValue
  | StaticRegExpValue
  | StaticSymbolValue
  | StaticComponentReferenceValue
  | StaticContextValue
  | StaticReactApiValue
  | StaticExternalValue
  | StaticNamespaceValue
  | StaticGlobalValue
  | StaticHostNodeValue
  | StaticNativeObjectValue
  | StaticMethodValue
  | StaticNativeFunctionValue
  | StaticProxyValue
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
  | "useMemoCache"
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
  /** The fiber tree React committed for the materialized element, as bippy observed it. */
  snapshot: RuntimeSnapshot;
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
  /** Package names to analyze from source; `@scope/*` admits every package in a scope (monorepo workspaces). */
  externalPackageAllowList?: string[];
  /** Apply React Server Components semantics: components outside `"use client"` modules render without a fiber. */
  serverComponents?: boolean;
  /**
   * Functions the boot code calls before mounting (registries, stores), as
   * `path#exportName` or `path#exportName(globalName, ...)` to pass `window`
   * properties; evaluated in order before the root.
   */
  bootstrap?: string[];
  /** `window` properties the served page defines (server-injected config); nested objects are partial, so unlisted keys stay unknown. */
  globals?: Record<string, JsonValue>;
  /** Expressions the bundler inlines at build time (`DefinePlugin`, Vite `define`), keyed by source text such as `process.env.FLAG`; an environment variable given `null` is unset. */
  defines?: Record<string, JsonValue>;
  /** The server process's environment, whole; unlisted variables are unset. */
  environment?: ProcessEnvironment;
  /** URL path (pathname, search, hash) the page is rendered at; `location` reads it. */
  route?: string;
  /** Origin (`http://localhost:3000`) the dev server serves the page from; `location` reads it and same-origin asset URLs resolve to its static files. */
  origin?: string;
  /** What a running page was observed to hold; the render takes these as its runtime inputs. */
  observations?: RuntimeObservations;
  externalValues?: ExternalValueProvider;
}
