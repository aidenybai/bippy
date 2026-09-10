import type {
  Argument,
  ArrayExpression,
  AssignmentExpression,
  AssignmentTarget,
  AssignmentTargetMaybeDefault,
  AwaitExpression,
  BinaryExpression,
  BindingIdentifier,
  BindingPattern,
  CallExpression,
  Class,
  Expression,
  Function as FunctionNode,
  JSXAttributeItem,
  JSXChild,
  JSXElement,
  JSXElementName,
  JSXFragment,
  JSXMemberExpressionObject,
  LogicalExpression,
  MemberExpression,
  NewExpression,
  Node,
  ObjectExpression,
  ObjectProperty,
  ParamPattern,
  PrivateInExpression,
  PropertyKey,
  SimpleAssignmentTarget,
  Span,
  Statement,
  SwitchStatement,
  TaggedTemplateExpression,
  TemplateLiteral,
  TryStatement,
  UnaryExpression,
  UnaryOperator,
  UpdateExpression,
  VariableDeclaration,
  VariableDeclarator,
} from "oxc-parser";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getAssetModuleValue, isAssetImport } from "../graph/asset-module.js";
import { getCssModuleValue, isCssModulePath } from "../graph/css-module.js";
import { getEsbuildDeclarationName } from "../graph/esbuild-symbol-names.js";
import { getTransformedRuntimeSpecifier } from "../graph/helper-packages.js";
import { getReactScriptsClientEnvironment } from "../graph/react-scripts.js";
import { isModuleRecord, type ModuleGraph } from "../graph/module-graph.js";
import { getPackageNameFromSpecifier, isInsideNodeModules } from "../graph/module-resolver.js";
import { nativeFunction } from "./stubs.js";
import { getLibraryValue } from "../libraries/index.js";
import { PurePackages } from "../libraries/pure-packages.js";
import {
  getDeclaredNames,
  getHoistedVarNames,
  getLeadingAwait,
  getMemberChain,
  getPatternNames,
  getVariableDeclaration,
  isFunctionLikeExpression,
  type LeadingAwaitOracle,
  getStaticMemberKey,
  unwrapExpression,
} from "../parse/ast-walk.js";
import { getSourceLocation } from "../parse/source-location.js";
import {
  CONTEXT_OWN_KEYS,
  FUNCTION_OWN_KEYS,
  getStubOwnKeys,
  REACT_ELEMENT_OWN_KEYS,
  WRAPPER_OWN_KEYS,
  doesStrictModeDoubleInvokeHookFactories,
  getReactElementSymbolKey,
  hasLegacyContext,
  REACT_ELEMENT_SYMBOL_KEYS,
} from "../react/element-shape.js";
import {
  splitElementKey,
  toClientReference,
  toElementKey,
  toElementType,
} from "../react/element-type.js";
import {
  getExternalMember,
  getReactApiTypeof,
  isClientOnlyReactApi,
  isReactLikePackage,
  REACT_MEMO_CACHE_SENTINEL_KEY,
  resolveReactApi,
  resolveReactApiMember,
} from "../react/react-api.js";
import {
  getCompilerHelper,
  getInlineCompilerHelper,
  getInlineHelperFunction,
  isEsModuleLike,
} from "./compiler-helpers.js";
import { createErrorValue } from "./errors.js";
import type {
  ClassBody,
  Diagnostic,
  ExternalValueProvider,
  FunctionLikeNode,
  ImportedName,
  JournaledState,
  CapturedExportReference,
  CapturedPageState,
  CapturedValue,
  JsonValue,
  ModuleRecord,
  LibraryRun,
  ProjectContext,
  ProcessEnvironment,
  ReactApi,
  RenderEnvironment,
  ResolvedSymbol,
  Scope,
  SourceLocation,
  StaticBranchValue,
  StaticClassValue,
  StaticElementType,
  StaticElementValue,
  StaticFunctionValue,
  StaticGlobalValue,
  StaticAccessor,
  StaticListValue,
  StaticNativeFunctionValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticPrimitive,
  StaticUnknownPrimitiveValue,
  StaticValue,
  StyledComponentsTransformOptions,
  SuperBinding,
  TopLevelBinding,
  UnknownPrimitiveType,
} from "../types.js";
import {
  INTRINSIC_PROTOTYPE_NAMES,
  evaluateBuiltinCall,
  getBuiltinGlobal,
  getGlobalTypeof,
  getTypeofValue,
  isModeledOpaqueMethodName,
  isPromiseMethodName,
} from "./builtin-calls.js";
import {
  collectClassMembers,
  constructClassInstance,
  getClassLength,
  getClassPrototypeObject,
  getComponentProperty,
  getFunctionLength,
  getReactBasePrototype,
  getStaticProperty,
  getSuperObject,
  hasKnownStaticChain,
  getValueParams,
  isReactComponentBase,
} from "./class-component.js";
import { getCollectionItems, markCollectionExternallyMutable } from "./collections.js";
import { createGeneratorValue } from "./generators.js";
import { getDocumentBaseUri, getPageLocationMember } from "./page-location.js";
import { hasExportedName, isClientModule } from "../graph/module-record.js";
import type { HostDocument } from "../host/host-document.js";
import { type HostPlatform, type HostRealm, loadHostRealm } from "../host/host-realm.js";
import {
  type SessionHistory,
  createSessionHistory,
  getHistoryMember,
  isHistoryName,
} from "./session-history.js";
import {
  BUNDLER_INJECTED_NAMES,
  DEV_SERVER_MODE,
  isBundlerUndeclaredName,
  isWebpackBundled,
  getInlinedNodeEnv,
  isEnvironmentObject,
  isUnsettableDefineName,
  isWebpackRequireName,
} from "./bundler-globals.js";
import { hasIntrinsicMember, hasProperty, OBJECT_PROTOTYPE_METHODS } from "./has-property.js";
import { getBuiltinWitness, isInstanceOf } from "./instance-of.js";
import { createIndexedDbFactory, isIndexedDbName } from "./indexed-db.js";
import { getBinaryMember, getBinaryWitness } from "./typed-arrays.js";
import { getWebCryptoMember, isWebCryptoName } from "./web-crypto.js";
import { GLOBAL_OBJECT_VALUE, getPrimitiveWitness } from "./host-globals.js";
import { toPropertyKey } from "./primitive-shapes.js";
import {
  applyNumberRangeOperator,
  compareNumberRanges,
  concatenateStrings,
  getShapedStringCharacter,
  getShapedStringLength,
  toStringValue,
} from "./primitive-shapes.js";
import {
  getCaughtValue,
  forgetThrowCertainty,
  getThrowCertainty,
  getThrownOperand,
  getThrownPaths,
  withoutThrows,
} from "./thrown.js";
import { assignEventHandlerProperty } from "./event-listeners.js";
import { startImageLoad } from "./resource-loading.js";
import {
  deleteNativeObjectComposedMember,
  deleteNativeObjectMember,
  getHostDocumentExpando,
  getNativeObjectComposedMember,
  getNativeObjectMember,
  hasHostDocumentMember,
  setHostDocumentMember,
  setNativeObjectComposedMember,
  setNativeObjectMember,
} from "./native-values.js";
import {
  HeapJournal,
  IN_PROGRESS,
  type ModuleValues,
  type MutableHeapValue,
} from "./heap-journal.js";
import {
  type StorageAreas,
  createStorageAreas,
  getStorageAreaName,
  getStorageLength,
} from "./web-storage.js";
import { type CompiledClass, getCompiledClass } from "./compiled-class.js";
import {
  collectStyledDisplayNames,
  DEFAULT_STYLED_COMPONENTS_TRANSFORM,
  STYLED_COMPONENTS_MACRO_SPECIFIER,
} from "./styled-components-transform.js";
import type { CallFrame, ContextReader, EvaluationContext, StepBudget } from "./context.js";
import type { StateCell } from "./hooks.js";
import { NO_PROVIDERS, withOutcomeHandler, withScope, withoutSuspension } from "./context.js";
import { decodeJsxEntities } from "./jsx-entities.js";
import { cleanJsxText } from "./jsx-text.js";
import { describeMacroJsxChildren, getStubExpandJsx } from "./macro-jsx.js";
import { EscapeMemo } from "./escape-memo.js";
import {
  type EscapedMutation,
  type EscapeFrame,
  type EscapeWalk,
  followStaleCallables,
  forEachEscapedCallable,
  getAccessRoot,
  getEscapedMutations,
  isClosureLocal,
  resolveAccessPath,
} from "./escapes.js";
import {
  type AsyncCall,
  awaitedValue,
  escapedPromiseValue,
  getModeledPromise,
  getPendingPromise,
  isAwaitDeferred,
  resolvedPromiseValue,
  suspendOnPromise,
} from "./promises.js";
import { applyClockOperator, TimerQueue } from "./timers.js";
import { evaluateLoop } from "./loops.js";
import {
  applyNarrowing,
  getDiscriminantTargets,
  lookupNarrowingTarget,
  type NarrowingTarget,
  narrowTest,
  narrowTestByEvaluation,
  type TestNarrowing,
  withNarrowedTarget,
} from "./narrowing.js";
import { evaluateReactApiCall } from "./react-calls.js";
import { RootRenderState } from "./root-render.js";
import { MutationLog } from "./mutation-log.js";
import { createScope, declareInScope, findOwningScope, lookupScope } from "./scope.js";
import {
  evaluateTypeScriptDeclaration,
  getTypeScriptDeclarationName,
} from "./typescript-declarations.js";
import {
  accessorEntry,
  areValuesEquivalent,
  branchValue,
  CHAIN_SHORT_CIRCUIT,
  compareIdentity,
  completeChain,
  componentReference,
  countAlternatives,
  describeValue,
  FALSE_VALUE,
  falsyCounterpart,
  truthyCounterpart,
  getClassPrototype,
  getSpreadEntries,
  getSymbolDescription,
  getListItem,
  getListLength,
  getFunctionPrototype,
  getObjectAccessor,
  getObjectProperty,
  getPreferredTruthiness,
  getStubDisplayName,
  getStubOwnName,
  getAllocationCount,
  getTruthiness,
  hasDefiniteItems,
  isNullish,
  isCallable,
  isSymbolPropertyKey,
  ITERATOR_PROPERTY_KEY,
  listValue,
  joinMappedAlternatives,
  mapValue,
  distributeBinary,
  NULL_VALUE,
  SYMBOL_PROPERTY_KEY_PREFIX,
  capturedValue,
  isJsonRecord,
  jsonValue,
  objectFromRecord,
  objectValue,
  deleteObjectProperty,
  omitRestKeys,
  partialJsonValue,
  primitiveValue,
  regExpToString,
  setListItem,
  setListLength,
  toIndexKey,
  spreadListItems,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  thrownValue,
  unknownValue,
} from "./values.js";
import {
  createPathPredicate,
  getPresencePredicate,
  getTruthinessPredicate,
  recordDerivation,
  recordNegation,
  recordRefinement,
} from "./predicates.js";
import type { CompareOperator, GuardLiteral } from "../harness/symbolic-tree.js";

export interface InterpreterOptions {
  maxCallDepth?: number;
  maxForkDepth?: number;
  maxSteps?: number;
  externalValues?: ExternalValueProvider;
  /** `window` properties the served page defines; objects are partial (see `partialJsonValue`). */
  globals?: Record<string, JsonValue>;
  /** Expressions the bundler replaces at build time (`DefinePlugin`, Vite `define`), e.g. `process.env.FLAG`. */
  defines?: Record<string, JsonValue>;
  /** `window` properties recorded whole from a running page (see `capturedValue`). */
  capturedGlobals?: Record<string, CapturedValue>;
  /** URL path the page is rendered at; `location.pathname`/`search`/`hash` read it. */
  route?: string;
  /** Origin the page is served from; `location.origin`/`host`/`href` read it. */
  origin?: string;
  /** Cookies and Web Storage the running page held; a fresh profile (empty) when absent. */
  page?: CapturedPageState;
  /** The server process's environment, whole; unlisted variables are unset. */
  environment?: ProcessEnvironment;
  /** The JavaScript host the client code runs on; browser when unset. */
  hostPlatform?: HostPlatform;
  /** The renderer's live document, lent to client code when its host has one. */
  hostDocument?: HostDocument;
  /** The rendered tree may be mounted under providers that are not part of the analysis, so unprovided contexts are uncertain. */
  assumeOuterProviders?: boolean;
  /** The analyzed app's React version; decides which `$$typeof` symbol tags elements. */
  reactVersion?: string | null;
  /** Quiet window (no React commit) after which the runtime snapshot is taken; timers delayed at least this long have not fired by then. */
  settleMs?: number;
  timerUnderrunMs?: number;
  project?: ProjectContext;
}

/**
 * One instantiation of the module graph. Under RSC the bundler builds a server
 * graph and a client graph, so a module both sides import runs twice: its
 * server instance sees `react`'s `react-server` export condition, its client
 * instance the full package.
 */
interface ModuleRegistry {
  scopes: Map<string, Scope>;
  values: Map<string, ModuleValues>;
  initialized: Set<string>;
  /** Modules whose top-level statements ran out of steps, leaving their state partially initialized. */
  exhausted: Set<string>;
  exportExpressionValues: WeakMap<Expression, StaticValue | typeof IN_PROGRESS>;
  /** One evaluation per destructuring declarator, shared by every name it binds. */
  destructuredInitValues: WeakMap<Expression, StaticValue>;
}

const createModuleRegistry = (): ModuleRegistry => ({
  scopes: new Map(),
  values: new Map(),
  initialized: new Set(),
  exhausted: new Set(),
  exportExpressionValues: new WeakMap(),
  destructuredInitValues: new WeakMap(),
});

const reactApiValue = (api: ReactApi, environment: RenderEnvironment | null): StaticValue =>
  environment === "server" && isClientOnlyReactApi(api)
    ? UNDEFINED_VALUE
    : { kind: "react-api", api };

interface JsxAttributeValues {
  props: StaticObjectValue;
  key: StaticValue | null;
}

/** What a file's JSX compiles to under its `@jsx`/`@jsxImportSource` annotation. */
interface JsxFactory {
  source: "classic" | "automatic";
  callee: StaticValue;
}

const REACT_FRAGMENT: StaticValue = { kind: "react-api", api: "Fragment" };

interface CallValueOptions {
  thisValue?: StaticValue | null;
  nameHint?: string | null;
  templateArgumentNames?: Array<string | null>;
}

type DestructuringPattern = BindingPattern | AssignmentTargetMaybeDefault;

interface PatternLeafAssigner {
  (leaf: BindingIdentifier | SimpleAssignmentTarget, value: StaticValue): void;
}

export const UNKNOWN_PROJECT: ProjectContext = {
  rootDirectory: null,
  servedDirectory: null,
  baseUrl: "/",
  mode: DEV_SERVER_MODE,
  hasDeclaredDependency: () => false,
  readPackageVersion: () => null,
  getImportedAssetUrl: (filePath) => unknownValue(`URL the bundler emits for ${filePath}`),
  transpiler: "name-preserving",
  bundler: "unknown",
  findServedFile: () => null,
  readServedAsset: () => null,
  findQuery: () => null,
  findMutations: () => null,
  linguiCatalog: null,
  routerState: null,
  storeStates: null,
};

/** The per-file names Node gives a module (CommonJS wrapper and `import.meta`); Vite's config loader injects the same. */
const getModulePathName = (name: string, filePath: string): StaticValue | null => {
  switch (name) {
    case "__dirname":
    case "import.meta.dirname":
      return primitiveValue(path.dirname(filePath));
    case "__filename":
    case "import.meta.filename":
      return primitiveValue(filePath);
    case "import.meta.url":
      return primitiveValue(pathToFileURL(filePath).href);
    default:
      return null;
  }
};

/** Vite's `vite:esbuild` default `include` filter; plain `.js` is served untransformed. */
const ESBUILD_TRANSFORMED_FILE = /\.(m?ts|[jt]sx)$/;

const DEFAULT_MAX_CALL_DEPTH = 128;
const DEFAULT_MAX_FORK_DEPTH = 5;
const DEFAULT_MAX_STEPS = 2_000_000;
const MAX_FORKED_REENTRIES = 1;
export const STYLED_JSX_SPECIFIER = "styled-jsx/style";

const MAX_INTERVAL_TICKS = 1_000;
const MAX_ITERATOR_STEPS = 256;
const USE_STRICT_DIRECTIVE = "use strict";
const FS_URL_PREFIX = "/@fs/";
const SERVER_HOST_PLATFORM: HostPlatform = "node";

const FUNCTION_INSTANCE_KEYS = new Set(["length", "prototype", "arguments", "caller"]);

/** Expressions the language names after their binding site (`NamedEvaluation`). */
const isAnonymousFunctionOrClass = (node: Expression): boolean => {
  switch (node.type) {
    case "ArrowFunctionExpression":
      return true;
    case "FunctionExpression":
    case "FunctionDeclaration":
    case "ClassExpression":
    case "ClassDeclaration":
      return node.id === null;
    default:
      return false;
  }
};

/** A `const f = () => {}` closes over its module like a declaration and creates nothing else. */
const isClosureBinding = (binding: TopLevelBinding): boolean =>
  binding.kind === "variable" &&
  binding.declarationKind === "const" &&
  isFunctionLikeExpression(binding.init);

/** Callees that ignore `this`: one call covers every receiver alternative that resolves to them. */
const isReceiverIndependent = (callee: StaticValue): boolean =>
  callee.kind === "react-api" || callee.kind === "native-function";

const FUNCTION_HAS_INSTANCE_KEY = `${SYMBOL_PROPERTY_KEY_PREFIX}Symbol.hasInstance`;

/** Names a function has without the analyzed code assigning them; any other name (well-known symbols included) reads `undefined`. */
const isFunctionOwnOrInheritedKey = (key: string): boolean =>
  isSymbolPropertyKey(key)
    ? key === FUNCTION_HAS_INSTANCE_KEY
    : FUNCTION_INSTANCE_KEYS.has(key) || hasIntrinsicMember(Function.prototype, key);

/** React's own functions are plain functions: only the intrinsic names exist until source defines more. */
const isReactApiFunctionKey = (key: string): boolean =>
  isSymbolPropertyKey(key)
    ? hasIntrinsicMember(Function.prototype, key)
    : isFunctionOwnOrInheritedKey(key);

/** Methods every callable inherits from `Function.prototype` and `Object.prototype`. */
const isCallableProtocolKey = (key: string): boolean =>
  key === "call" || key === "apply" || key === "bind" || OBJECT_PROTOTYPE_METHODS.has(key);

const REGEXP_FLAG_ACCESSORS = new Map([
  ["global", "g"],
  ["ignoreCase", "i"],
  ["multiline", "m"],
  ["dotAll", "s"],
  ["unicode", "u"],
  ["unicodeSets", "v"],
  ["sticky", "y"],
  ["hasIndices", "d"],
]);

/** A member read on a value whose prototype chain is fully known: absent names are `undefined`. */
const prototypeMember = (
  receiver: StaticValue,
  prototype: object | null,
  key: string,
): StaticValue =>
  prototype === null || hasIntrinsicMember(prototype, key)
    ? { kind: "method", receiver, name: key }
    : UNDEFINED_VALUE;

export type LoopJump = "break" | "continue";

/**
 * Result of evaluating a statement list. `returned` collects the values of every
 * path that returned; `mayComplete` is set when at least one path fell through
 * to the end of the list.
 */
export interface StatementOutcome {
  returned: StaticValue | null;
  mayComplete: boolean;
  /** Set when some path left the enclosing loop early; labeled jumps are `uncertain`. */
  jump: LoopJump | "uncertain" | null;
  /** The list stopped at an `await` of a pending promise; its rest runs once that settles. */
  isSuspended: boolean;
}

export const COMPLETES: StatementOutcome = {
  returned: null,
  mayComplete: true,
  jump: null,
  isSuspended: false,
};

const SUSPENDED: StatementOutcome = {
  returned: null,
  mayComplete: false,
  jump: null,
  isSuspended: true,
};

const jumpOutcome = (jump: LoopJump, label: string | null): StatementOutcome => ({
  returned: null,
  mayComplete: false,
  jump: label === null ? jump : "uncertain",
  isSuspended: false,
});

const mergeJumps = (outcomes: StatementOutcome[]): StatementOutcome["jump"] => {
  const jumps = outcomes.map((outcome) => outcome.jump).filter((jump) => jump !== null);
  if (jumps.length === 0) return null;
  return jumps.every((jump) => jump === jumps[0]) ? jumps[0] : "uncertain";
};

interface StatementContinuation {
  (context: EvaluationContext): StatementOutcome;
}

/** A fork whose returning paths still await the state the surviving paths end in. */
interface PendingReturnJoin {
  journal: HeapJournal;
  reason: string;
  location: SourceLocation;
  preferredPath: number;
}

const completeBlock: StatementContinuation = () => COMPLETES;

export const returnOutcome = (value: StaticValue): StatementOutcome => ({
  returned: value,
  mayComplete: false,
  jump: null,
  isSuspended: false,
});

const outcomeToReturnValue = (
  outcome: StatementOutcome,
  location: SourceLocation | null,
): StaticValue => {
  if (!outcome.returned) return UNDEFINED_VALUE;
  if (!outcome.mayComplete) return outcome.returned;
  return branchValue(
    [outcome.returned, UNDEFINED_VALUE],
    "function may fall through without returning",
    location,
  );
};

const isThrowingOutcome = (outcome: StatementOutcome): boolean =>
  outcome.returned !== null && getThrowCertainty(outcome.returned) === "always";

const isPureReturn = (outcome: StatementOutcome): boolean =>
  outcome.returned !== null && !outcome.mayComplete && outcome.jump === null;

const isPureCompletion = (outcome: StatementOutcome): boolean =>
  outcome.returned === null && outcome.mayComplete && outcome.jump === null;

/** A path that certainly throws is never what a rendered tree took; prefer the first path that may produce a value. */
const getPreferredOutcome = (outcomes: StatementOutcome[], preferredOutcome: number): number => {
  const preferred = outcomes[preferredOutcome];
  if (!preferred || !isThrowingOutcome(preferred)) return preferredOutcome;
  const survivor = outcomes.findIndex((outcome) => !isThrowingOutcome(outcome));
  return survivor === -1 ? preferredOutcome : survivor;
};

/**
 * `preferredBranch` is the index of the outcome the code is expected to take;
 * when that path completes without returning, the fall-through (last) outcome
 * is what it would return.
 */
export const mergeOutcomes = (
  outcomes: StatementOutcome[],
  reason: string,
  location: SourceLocation | null,
  preferredBranch = 0,
  predicate: string | null = null,
): StatementOutcome => {
  const returnedValues: StaticValue[] = [];
  let preferredIndex = 0;
  const preferredOutcome = getPreferredOutcome(outcomes, preferredBranch);
  const isFallThroughPreferred = !outcomes[preferredOutcome]?.returned;
  outcomes.forEach((outcome, index) => {
    if (!outcome.returned) return;
    if (index === preferredOutcome || (isFallThroughPreferred && index === outcomes.length - 1)) {
      preferredIndex = returnedValues.length;
    }
    returnedValues.push(outcome.returned);
  });
  return {
    returned:
      returnedValues.length > 0
        ? branchValue(
            returnedValues,
            reason,
            location,
            preferredIndex,
            returnedValues.length === outcomes.length ? predicate : null,
          )
        : null,
    mayComplete: outcomes.some((outcome) => outcome.mayComplete),
    jump: mergeJumps(outcomes),
    isSuspended: outcomes.some((outcome) => outcome.isSuspended),
  };
};

/** A counter or flag threaded through a recursion; it only bounds a walk whose data the analysis cannot see. */
const isSameTypePrimitive = (previous: StaticValue, next: StaticValue): boolean =>
  previous.kind === "primitive" &&
  next.kind === "primitive" &&
  typeof previous.value === typeof next.value;

const hasSameProperties = (
  previous: Map<string, StaticValue>,
  next: Map<string, StaticValue>,
): boolean =>
  previous.size === next.size && [...previous].every(([key, value]) => next.get(key) === value);

/**
 * A recursive call whose arguments and receiver are equivalent to those of an
 * activation already on the stack, with nothing that predates that activation
 * written since it began, would never bottom out (dynamic values never become
 * more precise). Writes to what the activation allocated itself (a fresh
 * receiver or accumulator, its own locals) reach the deeper call only through
 * the receiver and arguments, which the comparison already covers. Nor
 * would one that only threads unknowns forward with a changing counter
 * (`walk(node.child, depth + 1)` over an unknown `node`): every level sees
 * the same unknown data, so the result is unknown either way. One re-entered
 * from inside a fork that opened during that activation (a recursive-descent
 * parser's `case GroupStart: this.parseNodes()` over an unknown input) is
 * followed once more, since the state that changed may decide the re-entry
 * (a batch flush whose effect re-enters the flush after the batch depth
 * changed) but no further: past that, only data the analysis cannot see
 * decides whether it recurses, so how deep it goes is unknown, as for a loop
 * with an uncertain exit. A call that makes progress over known data
 * (walking a tree) is followed until the call-depth limit, as is a function
 * re-entered after rewriting its own properties (a proxy that swaps in the
 * real implementation on first call and calls itself again). The receiver is
 * an input like any argument: a method re-entered on an unknown receiver is
 * as stuck as one re-entered on an unknown argument.
 */
const isNonProgressingRecursion = (
  callStack: CallFrame[],
  functionValue: StaticFunctionValue,
  args: StaticValue[],
  thisValue: StaticValue | null,
  mutations: MutationLog,
  forkDepth: number,
): boolean => {
  const inputs = [thisValue ?? UNDEFINED_VALUE, ...args];
  const hasUnknownInput = inputs.some(mayBeUnknown);
  const isSameInput = (previous: StaticValue, next: StaticValue): boolean =>
    areValuesEquivalent(previous, next) ||
    (hasUnknownInput &&
      ((mayBeUnknown(previous) && mayBeUnknown(next)) || isSameTypePrimitive(previous, next)));
  const activations = callStack.filter(
    (frame) =>
      frame.node === functionValue.node &&
      frame.scope === functionValue.scope &&
      frame.args.length === args.length &&
      hasSameProperties(frame.properties, functionValue.properties) &&
      [frame.thisValue ?? UNDEFINED_VALUE, ...frame.args].every((input, index) =>
        isSameInput(input, inputs[index]),
      ),
  );
  if (
    activations.some(
      (frame) =>
        hasUnknownInput || mutations.oldestMutationSince(frame.changeCount) > frame.allocation,
    )
  ) {
    return true;
  }
  return activations.filter((frame) => frame.forkDepth < forkDepth).length > MAX_FORKED_REENTRIES;
};

const getCallReceiver = (
  functionValue: StaticFunctionValue,
  options: CallOptions,
): StaticValue | null =>
  functionValue.node.type === "ArrowFunctionExpression"
    ? functionValue.thisValue
    : (options.thisValue ?? null);

/** An unknown, a member/result of an unanalyzed external, or a branch holding one: further recursion cannot make it more precise. */
const mayBeUnknown = (value: StaticValue): boolean =>
  value.kind === "unknown" ||
  (value.kind === "external" && value.origin === "derived") ||
  (value.kind === "branch" && value.alternatives.some(mayBeUnknown));

const describeEscapedMutation = ({ target, key, kind }: EscapedMutation): string =>
  `"${[...target, ...(key === null || kind === "method" ? [] : [key])].join(".")}" is mutated by code the analysis did not run`;

const isEscapedRepeat = (item: StaticValue, reason: string): boolean =>
  item.kind === "repeat" && item.item.kind === "unknown" && item.item.reason === reason;

/**
 * `Array.prototype` mutators called from escaped code: `push`/`unshift` add any
 * number of items the analysis never saw at one end, the rest may leave any
 * contents behind.
 */
const markListEscapedMutation = (list: StaticListValue, method: string, reason: string): void => {
  if (list.items.some((item) => isEscapedRepeat(item, reason))) return;
  const escaped: StaticValue = { kind: "repeat", item: unknownValue(reason), location: null };
  if (method === "push") list.items.push(escaped);
  else if (method === "unshift") list.items.unshift(escaped);
  else list.items = [escaped];
};

/** A captured variable escaped code reassigns holds either the value the analysis saw or one it did not. */
const widenEscapedBinding = (value: StaticValue, reason: string): StaticValue =>
  mayBeUnknown(value) ? value : branchValue([value, unknownValue(reason)], reason);

const markExternallyMutable = (value: StaticObjectValue, reason: string): void => {
  if (markCollectionExternallyMutable(value)) return;
  if (value.entries.some((entry) => entry.kind === "spread" && entry.value.kind === "unknown")) {
    return;
  }
  value.entries.push({ kind: "spread", value: unknownValue(reason) });
};

/**
 * A mutation of a statically known property widens that property alone and a
 * computed member the whole object. A mutating method call widens a collection
 * or an array: a plain object defines such a method itself, so the method body
 * is the mutation. Each is idempotent, so following a closure again leaves the
 * object as it was.
 */
const markEscapedMutation = (value: StaticValue, mutation: EscapedMutation): void => {
  const reason = describeEscapedMutation(mutation);
  if (value.kind === "list") {
    if (mutation.kind === "method" && mutation.key !== null) {
      markListEscapedMutation(value, mutation.key, reason);
    }
    return;
  }
  if (value.kind !== "object") return;
  if (mutation.kind === "method") {
    markCollectionExternallyMutable(value);
    return;
  }
  if (mutation.key === null) {
    markExternallyMutable(value, reason);
    return;
  }
  const current = getObjectProperty(value, mutation.key);
  if (mayBeUnknown(current)) return;
  value.entries.push({
    kind: "property",
    key: mutation.key,
    value: branchValue([current, unknownValue(reason)], reason),
  });
};

interface CallOptions {
  thisValue?: StaticValue | null;
  callStack?: CallFrame[];
  /** The caller awaits the result (route `lazy`, server components), so an async body is evaluated with `await x` as `x`. */
  awaited?: boolean;
}

export class Interpreter {
  readonly graph: ModuleGraph;
  readonly diagnostics: Diagnostic[] = [];
  readonly assumeOuterProviders: boolean;
  private readonly maxCallDepth: number;
  private readonly maxForkDepth: number;
  private readonly externalValues: ExternalValueProvider | null;
  readonly project: ProjectContext;
  private readonly libraryRun: LibraryRun;
  readonly origin: string | null;
  readonly history: SessionHistory;
  private readonly purePackages: PurePackages | null;
  private readonly windowGlobals = new Map<string, StaticValue>();
  /** Properties the analyzed code defined on React's own functions (`React.createContext[key] = ...`). */
  private readonly reactApiProperties = new Map<ReactApi, Map<string, StaticValue>>();
  /** Properties the analyzed code defined on builtin globals other than the global object (`Array[key] = ...`). */
  private readonly globalExpandos = new Map<string, StaticValue>();
  private readonly defines = new Map<string, StaticValue>();
  private readonly definedEnvironmentObjects = new Set<string>();
  private readonly pageState: CapturedPageState | null;
  private readonly processEnvironment: ProcessEnvironment | null;
  private readonly clientRealm: HostRealm;
  private readonly serverRealm: HostRealm;
  readonly hostDocument: HostDocument | null;
  readonly storageAreas: StorageAreas;
  readonly indexedDb = createIndexedDbFactory();
  readonly timers: TimerQueue;
  readonly rootRender = new RootRenderState();
  readonly mutations = new MutationLog();
  private readonly heapJournals: HeapJournal[] = [];
  private readonly pendingReturnJoins: PendingReturnJoin[] = [];
  /** The outcomes of the `await`s a statement is being (re-)evaluated with, each consumed by its `await`. */
  private resolvedAwaits = new Map<AwaitExpression, StaticValue>();
  private readonly generatorYields: StaticValue[][] = [];
  private readonly elementSymbolKey: string;
  private readonly reactVersion: string | null;
  readonly doesStrictModeDoubleInvokeHookFactories: boolean;
  /** Whether class components still receive `contextTypes`-masked legacy context (`disableLegacyContext`). */
  readonly hasLegacyContext: boolean;
  private readonly maxSteps: number;
  private readonly clientRegistry = createModuleRegistry();
  private readonly serverRegistry = createModuleRegistry();
  /** Module variables mutated by escaped closures before the variable was evaluated, by file, name and property key. */
  private readonly escapedMutations = new Map<string, Map<string, Set<EscapedMutation>>>();
  private readonly diagnosticKeys = new Set<string>();
  /** The `super(...)` each instance under construction runs, for lowered constructors calling it through `Reflect.construct`. */
  readonly pendingSuperBindings = new WeakMap<StaticObjectValue, SuperBinding>();
  /** The styled-components transform the project's build applies to its own modules; `null` when it has none. */
  styledComponentsTransform: StyledComponentsTransformOptions | null;
  private readonly styledDisplayNames = new WeakMap<ModuleRecord, Map<Node, string>>();

  constructor(graph: ModuleGraph, options: InterpreterOptions = {}) {
    this.graph = graph;
    this.timers = new TimerQueue(options.settleMs, options.timerUnderrunMs);
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
    this.maxForkDepth = options.maxForkDepth ?? DEFAULT_MAX_FORK_DEPTH;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.externalValues = options.externalValues ?? null;
    this.project = options.project ?? UNKNOWN_PROJECT;
    this.libraryRun = { project: this.project };
    this.origin = options.origin ?? null;
    this.pageState = options.page ?? null;
    this.history = createSessionHistory(this.pageState, options.route ?? null);
    this.processEnvironment = options.environment ?? null;
    this.clientRealm = loadHostRealm(options.hostPlatform ?? "browser");
    this.serverRealm = loadHostRealm(SERVER_HOST_PLATFORM);
    this.hostDocument = this.clientRealm.hasDocument ? (options.hostDocument ?? null) : null;
    this.storageAreas = createStorageAreas(this.pageState);
    this.purePackages =
      this.project.rootDirectory === null ? null : new PurePackages(this.project.rootDirectory);
    for (const [name, json] of Object.entries(options.globals ?? {})) {
      this.windowGlobals.set(name, partialJsonValue(json, `window.${name}`));
    }
    for (const [name, captured] of Object.entries(options.capturedGlobals ?? {})) {
      this.windowGlobals.set(name, this.captured(captured, `window.${name}`));
    }
    const defines = options.defines ?? {};
    for (const [name, json] of Object.entries(defines)) {
      if (isEnvironmentObject(name) && isJsonRecord(json)) {
        this.definedEnvironmentObjects.add(name);
        for (const [variable, variableJson] of Object.entries(json)) {
          const variableName = `${name}.${variable}`;
          if (!(variableName in defines)) this.defines.set(variableName, jsonValue(variableJson));
        }
        continue;
      }
      const isUnset = json === null && isUnsettableDefineName(name);
      this.defines.set(name, isUnset ? UNDEFINED_VALUE : jsonValue(json));
    }
    if (this.project.bundler === "react-scripts" && this.project.rootDirectory !== null) {
      const clientEnvironment = getReactScriptsClientEnvironment(
        this.project.rootDirectory,
        this.processEnvironment,
      );
      for (const [variable, value] of Object.entries(clientEnvironment)) {
        const name = `process.env.${variable}`;
        if (!this.defines.has(name)) this.defines.set(name, primitiveValue(value));
      }
    }
    this.reactVersion = options.reactVersion ?? null;
    this.elementSymbolKey = getReactElementSymbolKey(this.reactVersion);
    this.doesStrictModeDoubleInvokeHookFactories = doesStrictModeDoubleInvokeHookFactories(
      this.reactVersion,
    );
    this.hasLegacyContext = hasLegacyContext(this.reactVersion);
    this.assumeOuterProviders = options.assumeOuterProviders ?? false;
    this.styledComponentsTransform = this.project.hasDeclaredDependency(
      "babel-plugin-styled-components",
    )
      ? DEFAULT_STYLED_COMPONENTS_TRANSFORM
      : null;
  }

  /** A value recorded from the running page, with references to the project's own module exports evaluated. */
  captured(captured: CapturedValue, name: string): StaticValue {
    return capturedValue(captured, name, (reference) => this.resolveCapturedExport(reference));
  }

  // Dev servers address a module by its path under the served root, or under
  // `/@fs/` when it lies outside (Vite; a linked workspace package).
  private resolveCapturedExport(reference: CapturedExportReference): StaticValue | null {
    if (this.project.servedDirectory === null) return null;
    const filePath = reference.module.startsWith(FS_URL_PREFIX)
      ? reference.module.slice(FS_URL_PREFIX.length - 1)
      : path.join(this.project.servedDirectory, reference.module);
    const module = this.graph.getModule(filePath);
    return module && this.evaluateModuleExport(module, reference.name);
  }

  getWindowGlobal(name: string): StaticValue {
    return this.windowGlobals.get(name) ?? unknownValue(`window.${name}`);
  }

  /** The host whose globals code in this rendering environment sees: server-rendered code runs in Node whatever the client host is. */
  getRealm(environment: RenderEnvironment | null): HostRealm {
    return environment === "server" ? this.serverRealm : this.clientRealm;
  }

  private getReactVersionExport(packageName: string, exportedName: string): StaticValue | null {
    if (exportedName !== "version" || this.reactVersion === null) return null;
    return isReactLikePackage(packageName) ? primitiveValue(this.reactVersion) : null;
  }

  report(
    code: string,
    message: string,
    location: SourceLocation | null,
    severity: Diagnostic["severity"] = "info",
  ): void {
    const key = `${code}\u0000${message}\u0000${location?.filePath}:${location?.line}:${location?.column}`;
    if (this.diagnosticKeys.has(key)) return;
    this.diagnosticKeys.add(key);
    this.diagnostics.push({ severity, code, message, location });
  }

  locate(module: ModuleRecord, span: Span): SourceLocation {
    return getSourceLocation(module.file, span);
  }

  createModuleContext(
    module: ModuleRecord,
    readContext: ContextReader = NO_PROVIDERS,
    environment: RenderEnvironment | null = null,
  ): EvaluationContext {
    return {
      module,
      scope: this.getModuleScope(module, environment),
      budget: { remaining: this.maxSteps },
      thisValue: module.isCommonJs ? objectValue() : UNDEFINED_VALUE,
      superBinding: null,
      readContext,
      callStack: [],
      uncertainDepth: 0,
      forkDepth: 0,
      environment,
      hooks: null,
      suspension: null,
    };
  }

  /** A `"use client"` module only ever runs in the client graph; any other module reached from server code runs in the server graph. */
  private getModuleRegistry(
    module: ModuleRecord,
    environment: RenderEnvironment | null,
  ): ModuleRegistry {
    return environment === "server" && !isClientModule(module)
      ? this.serverRegistry
      : this.clientRegistry;
  }

  /** The environment a module's own top-level code runs in when reached from `environment`. */
  private getModuleInstanceEnvironment(
    module: ModuleRecord,
    environment: RenderEnvironment | null,
  ): RenderEnvironment | null {
    return this.getModuleRegistry(module, environment) === this.serverRegistry ? "server" : null;
  }

  getModuleScope(module: ModuleRecord, environment: RenderEnvironment | null): Scope {
    const { scopes } = this.getModuleRegistry(module, environment);
    let scope = scopes.get(module.filePath);
    if (!scope) {
      scope = createScope(null);
      scopes.set(module.filePath, scope);
    }
    return scope;
  }

  evaluateModuleExport(
    module: ModuleRecord,
    exportedName: string,
    environment: RenderEnvironment | null = null,
  ): StaticValue {
    return this.resolvedSymbolToValue(
      this.graph.resolveExport(module, exportedName),
      exportedName,
      environment,
    );
  }

  /** Bundler interop: a default import is `module.exports` itself unless it is flagged `__esModule`. */
  private evaluateModuleExportsMember(
    module: ModuleRecord,
    exportedName: string,
    environment: RenderEnvironment | null,
  ): StaticValue {
    const moduleExports = this.evaluateModuleExports(module, environment);
    if (exportedName === "default" && !isEsModuleLike(moduleExports, null)) return moduleExports;
    return this.getProperty(
      moduleExports,
      exportedName,
      this.createModuleContext(module, undefined, environment),
      null,
    );
  }

  private evaluateModuleExports(
    module: ModuleRecord,
    environment: RenderEnvironment | null,
  ): StaticValue {
    if (!module.moduleExports) return { kind: "namespace", module };
    const value = this.resolvedSymbolToValue(
      {
        kind: "expression",
        module,
        exportedName: "default",
        expression: module.moduleExports,
        isClientReference: false,
      },
      "default",
      environment,
    );
    if (value.kind === "function" || value.kind === "class") {
      for (const name of module.moduleExportsMembers) {
        if (!value.properties.has(name)) {
          value.properties.set(name, this.evaluateModuleExport(module, name));
        }
      }
    }
    return value;
  }

  /**
   * A name a namespace lacks is `undefined` when its export list is complete:
   * an ESM module whose `export *` sources are all analyzed, or a CommonJS
   * module that replaces `module.exports`, whose own `exports` object only
   * holds the statically collected members.
   */
  private getNamespaceMember(
    module: ModuleRecord,
    key: string,
    environment: RenderEnvironment | null,
  ): StaticValue {
    if (hasExportedName(module, key)) return this.evaluateModuleExport(module, key, environment);
    if (key === "__esModule") return module.isCommonJs ? UNDEFINED_VALUE : TRUE_VALUE;
    if (module.isCommonJs && module.moduleExports === null) {
      return this.evaluateModuleExport(module, key, environment);
    }
    const { names, complete } = this.graph.collectExportNames(module);
    return complete && !names.includes(key)
      ? UNDEFINED_VALUE
      : this.evaluateModuleExport(module, key, environment);
  }

  /**
   * The exports of a module as an object, for `{ ...m }` / `Object.keys(m)`
   * over a namespace. An ESM namespace lists its exports in code-unit order;
   * a CommonJS `exports` object keeps assignment order.
   */
  materializeNamespace(module: ModuleRecord, environment: RenderEnvironment | null): StaticValue {
    const { names, complete } = this.graph.collectExportNames(module);
    if (!complete) {
      return unknownValue(`namespace of ${module.filePath} re-exports an unanalyzed module`);
    }
    const orderedNames = module.isCommonJs ? names : [...names].sort();
    return objectValue(
      orderedNames.map((name) => ({
        kind: "property",
        key: name,
        value: this.evaluateModuleExport(module, name, environment),
      })),
    );
  }

  private getModuleValues(
    module: ModuleRecord,
    environment: RenderEnvironment | null,
  ): ModuleValues {
    const registryValues = this.getModuleRegistry(module, environment).values;
    let values = registryValues.get(module.filePath);
    if (!values) {
      values = new Map();
      registryValues.set(module.filePath, values);
    }
    return values;
  }

  evaluateModuleBinding(
    module: ModuleRecord,
    name: string,
    environment: RenderEnvironment | null,
  ): StaticValue | null {
    const binding = module.bindings.get(name);
    if (!binding) return null;
    this.initializeModule(module, module.sideEffectStatements, environment);
    return (
      this.exhaustedModuleValue(module, environment) ??
      this.evaluateDeclaredBinding(module, binding, environment)
    );
  }

  private exhaustedModuleValue(
    module: ModuleRecord,
    environment: RenderEnvironment | null,
  ): StaticValue | null {
    return this.getModuleRegistry(module, environment).exhausted.has(module.filePath)
      ? unknownValue(`module initialization of ${module.filePath} exhausted the step budget`)
      : null;
  }

  /**
   * A module binding as escape analysis may see it without running the module:
   * whatever is already evaluated, plus hoisted function and class declarations,
   * whose creation has no side effects.
   */
  private peekModuleBinding(module: ModuleRecord, name: string): StaticValue | null {
    const binding = module.bindings.get(name);
    if (!binding) return null;
    const cached = this.getModuleValues(module, null).get(name);
    if (cached) return cached === IN_PROGRESS ? null : cached;
    return binding.kind === "function" || binding.kind === "class" || isClosureBinding(binding)
      ? this.evaluateDeclaredBinding(module, binding, null)
      : null;
  }

  private evaluateDeclaredBinding(
    module: ModuleRecord,
    binding: TopLevelBinding,
    environment: RenderEnvironment | null,
  ): StaticValue {
    const { name } = binding;
    const values = this.getModuleValues(module, environment);
    const cached = values.get(name);
    if (cached === IN_PROGRESS) {
      if (binding.kind === "variable" && binding.declarationKind === "var") return UNDEFINED_VALUE;
      return unknownValue(
        `cyclic module-level evaluation of "${name}"`,
        this.locate(module, binding.span),
      );
    }
    if (cached) return cached;
    values.set(name, IN_PROGRESS);
    let value = this.evaluateTopLevelBindingValue(
      module,
      binding,
      this.createModuleContext(
        module,
        undefined,
        this.getModuleInstanceEnvironment(module, environment),
      ),
    );
    for (const mutation of this.escapedMutations.get(module.filePath)?.get(name) ?? []) {
      if (mutation.kind === "rebinding") {
        value = widenEscapedBinding(value, describeEscapedMutation(mutation));
      } else {
        markEscapedMutation(value, mutation);
      }
    }
    values.set(name, value);
    this.escapeWalk.memo.invalidate(module, name);
    this.journalLazyBindingValue(value);
    return value;
  }

  /**
   * A top-level binding first read inside a fork was declared before the fork
   * began, so a path mutating it must not leak that mutation into the others.
   */
  private journalLazyBindingValue(value: StaticValue): void {
    if (value.kind !== "object" && value.kind !== "list") return;
    for (const journal of this.heapJournals) journal.record(value);
  }

  /**
   * Runs a module's top-level statements once, after those of its static
   * imports, in ESM evaluation order: `X.displayName = ...`, registry
   * registrations and polyfills land before anything reads their targets.
   * Call-initialized declarations go through the module value cache so the
   * call runs exactly once and its bindings keep their identity.
   */
  initializeModule(
    module: ModuleRecord,
    sideEffectStatements: Statement[] = module.sideEffectStatements,
    environment: RenderEnvironment | null = null,
  ): void {
    const { initialized, exhausted } = this.getModuleRegistry(module, environment);
    if (initialized.has(module.filePath)) return;
    initialized.add(module.filePath);
    const instanceEnvironment = this.getModuleInstanceEnvironment(module, environment);
    this.initializeDependencies(module, instanceEnvironment);
    const context = this.createModuleContext(module, undefined, instanceEnvironment);
    for (const name of getHoistedVarNames(sideEffectStatements)) {
      if (!module.bindings.has(name) && !context.scope.bindings.has(name)) {
        declareInScope(context.scope, name, UNDEFINED_VALUE);
      }
    }
    let pendingStatements: Statement[] = [];
    const flushPendingStatements = (): void => {
      if (pendingStatements.length === 0) return;
      this.evaluateFunctionBlock(pendingStatements, context);
      pendingStatements = [];
    };
    for (const statement of sideEffectStatements) {
      const declaration = getVariableDeclaration(statement);
      if (!declaration) {
        pendingStatements.push(statement);
        continue;
      }
      flushPendingStatements();
      for (const name of getDeclaredNames(declaration)) {
        this.evaluateModuleBinding(module, name, instanceEnvironment);
      }
    }
    flushPendingStatements();
    for (const name of module.outParameterBindings) {
      this.evaluateModuleBinding(module, name, instanceEnvironment);
    }
    if (context.budget.remaining <= 0) {
      exhausted.add(module.filePath);
      this.report(
        "budget-exhausted",
        `module initialization of ${module.filePath} exhausted the step budget; its exports are unknown`,
        null,
        "warning",
      );
    }
  }

  private initializeDependencies(
    module: ModuleRecord,
    environment: RenderEnvironment | null,
  ): void {
    for (const specifier of module.dependencies) {
      const target = this.graph.resolveImportedModule(specifier, module);
      if (isModuleRecord(target)) {
        this.initializeModule(target, target.sideEffectStatements, environment);
      }
    }
  }

  resolvedSymbolToValue(
    symbol: ResolvedSymbol,
    nameHint: string | null,
    environment: RenderEnvironment | null,
  ): StaticValue {
    switch (symbol.kind) {
      case "binding": {
        const value =
          this.evaluateModuleBinding(symbol.module, symbol.binding.name, environment) ??
          UNDEFINED_VALUE;
        return symbol.isClientReference ? toClientReference(value) : value;
      }
      case "expression": {
        const value = this.evaluateExportExpression(
          symbol.module,
          symbol.expression,
          symbol.module.isCommonJs ? nameHint : "default",
          environment,
        );
        return symbol.isClientReference ? toClientReference(value) : value;
      }
      case "namespace":
        return { kind: "namespace", module: symbol.module };
      case "module-exports": {
        const value = this.evaluateModuleExportsMember(
          symbol.module,
          symbol.exportedName,
          environment,
        );
        return symbol.isClientReference ? toClientReference(value) : value;
      }
      case "external": {
        const importedName =
          symbol.imported.kind === "named"
            ? symbol.imported.name
            : symbol.imported.kind === "default"
              ? "default"
              : "*";
        const helper = getCompilerHelper(symbol.packageName, symbol.specifier, importedName);
        if (helper) return helper;
        if (symbol.imported.kind === "named") {
          const api = resolveReactApi(symbol.packageName, symbol.imported.name, symbol.specifier);
          if (api) return reactApiValue(api, environment);
          const version = this.getReactVersionExport(symbol.packageName, symbol.imported.name);
          if (version) return version;
        }
        const provided = this.getModeledExternal(symbol.specifier, importedName, symbol.filePath);
        if (provided) return provided;
        if (symbol.imported.kind === "namespace" || symbol.imported.kind === "default") {
          const api = resolveReactApi(symbol.packageName, "*");
          if (api) return { kind: "react-api", api };
        }
        return {
          kind: "external",
          packageName: symbol.packageName,
          specifier: symbol.specifier,
          importedName,
          origin: "binding",
        };
      }
      case "stylesheet":
        return getCssModuleValue(symbol.filePath, symbol.imported);
      case "asset":
        return getAssetModuleValue(
          symbol.filePath,
          symbol.specifier,
          symbol.imported,
          this.project,
        );
      case "unresolved":
        return unknownValue(symbol.reason);
    }
  }

  private getModeledExternal(
    specifier: string,
    importedName: string,
    filePath: string | null = null,
  ): StaticValue | null {
    const modeled =
      this.externalValues?.(specifier, importedName) ??
      getLibraryValue(specifier, importedName, this.libraryRun);
    if (modeled) return modeled;
    const pure = this.purePackages?.getExport(specifier, importedName, filePath);
    if (!pure || importedName !== "default" || pure.kind !== "native-function") return pure ?? null;
    return {
      ...pure,
      getOwnProperty: (key) => this.getPureNamespaceMember(pure, specifier, key, filePath),
    };
  }

  /** `_.debounce` on a pure package's default export: each member resolves as the named import would. */
  private getPureNamespaceMember(
    namespace: StaticNativeFunctionValue,
    specifier: string,
    key: string,
    filePath: string | null,
  ): StaticValue | undefined {
    const packageName = getPackageNameFromSpecifier(specifier);
    const own = namespace.getOwnProperty?.(key);
    if (packageName === null || own === undefined) return own;
    return (
      this.getModeledExternal(specifier, key, filePath) ?? {
        kind: "external",
        packageName,
        specifier,
        importedName: `default.${key}`,
        origin: "derived",
      }
    );
  }

  /**
   * `export default expr` / `exports.name = expr` evaluate once so the exported
   * identity is stable. Only an anonymous function or class written in place is
   * named after the export (`export default () => ...` is `default`); what a
   * call returns keeps whatever name the call gave it.
   */
  private evaluateExportExpression(
    module: ModuleRecord,
    expression: Expression,
    exportedName: string | null,
    environment: RenderEnvironment | null,
  ): StaticValue {
    const nameHint = isAnonymousFunctionOrClass(expression) ? exportedName : null;
    const { exportExpressionValues } = this.getModuleRegistry(module, environment);
    const cached = exportExpressionValues.get(expression);
    if (cached === IN_PROGRESS) {
      return unknownValue(
        "cyclic module-level evaluation of an export",
        this.locate(module, expression),
      );
    }
    if (cached) return cached;
    const exhausted = this.exhaustedModuleValue(module, environment);
    if (exhausted) return exhausted;
    exportExpressionValues.set(expression, IN_PROGRESS);
    const value = this.evaluateExpression(
      expression,
      this.createModuleContext(
        module,
        undefined,
        this.getModuleInstanceEnvironment(module, environment),
      ),
      nameHint,
    );
    exportExpressionValues.set(expression, value);
    return value;
  }

  /** What React does with a `ref` on commit: call a callback ref or set `current` on a ref object. */
  assignRef(
    ref: StaticValue,
    node: StaticValue,
    context: EvaluationContext,
    location: SourceLocation | null,
  ): void {
    switch (ref.kind) {
      case "object":
        this.assignProperty(ref, "current", node, context);
        return;
      case "function":
      case "native-function":
      case "method":
      case "proxy":
        this.callValue(ref, [node], context, location);
        return;
      case "branch":
        for (const alternative of ref.alternatives)
          this.assignRef(alternative, node, context, location);
        return;
      case "optional":
        this.assignRef(ref.value, node, context, location);
        return;
      default:
        return;
    }
  }

  /** `target[propertyName] = value`; returns the value the binding should now hold (wrappers are re-created for `displayName`). */
  assignProperty(
    target: StaticValue,
    propertyName: string,
    value: StaticValue,
    context: EvaluationContext,
  ): StaticValue {
    switch (target.kind) {
      case "object": {
        const accessor = getObjectAccessor(target, propertyName);
        if (accessor) {
          if (accessor.set) {
            this.callValue(accessor.set, [value], context, null, {
              thisValue: target,
            });
          }
          return target;
        }
        this.assignOwnProperty(target, propertyName, value);
        return target;
      }
      case "list": {
        if (target.isFrozen) return target;
        const index = toIndexKey(propertyName);
        if (index !== null) {
          this.recordHeapMutation(target);
          if (context.uncertainDepth > 0 && index >= target.items.length) {
            target.items.push({ kind: "repeat", item: value, location: null });
          } else {
            setListItem(
              target,
              index,
              this.withUncertainAssignment(target.items[index], value, `[${index}]`, context),
            );
          }
          return target;
        }
        if (propertyName === "length") {
          this.recordHeapMutation(target);
          setListLength(
            target,
            value.kind === "primitive" && typeof value.value === "number" ? value.value : null,
          );
          return target;
        }
        this.recordHeapMutation(target);
        target.properties ??= new Map();
        target.properties.set(propertyName, value);
        return target;
      }
      case "function":
      case "class":
        this.mutations.record(0);
        if (target.kind === "function") this.escapeWalk.memo.invalidate(target, propertyName);
        target.properties.set(propertyName, value);
        return target;
      case "react-api":
        this.setReactApiProperty(target.api, propertyName, value, context);
        return target;
      case "global": {
        const hostDocument = this.getHostDocument(target, context.environment);
        if (hostDocument !== null) setHostDocumentMember(hostDocument, propertyName, value);
        else this.setGlobalMember(target, propertyName, value, context);
        return target;
      }
      case "regexp":
        if (propertyName === "lastIndex") {
          target.lastIndex =
            value.kind === "primitive" && typeof value.value === "number" ? value.value : 0;
        }
        return target;
      case "native-object":
        if (
          assignEventHandlerProperty(
            this,
            this.getRealm(context.environment),
            target,
            propertyName,
            value,
            context,
          )
        ) {
          return target;
        }
        setNativeObjectMember(target, propertyName, value);
        startImageLoad(this, target, propertyName, value, context);
        return target;
      case "proxy": {
        const trap = getObjectProperty(target.handler, "set");
        if (trap.kind === "primitive" && trap.value === undefined) {
          this.assignProperty(target.target, propertyName, value, context);
        } else {
          this.callValue(
            trap,
            [target.target, primitiveValue(propertyName), value, target],
            context,
            null,
          );
        }
        return target;
      }
      case "context":
        if (
          propertyName === "displayName" &&
          value.kind === "primitive" &&
          typeof value.value === "string"
        ) {
          target.context.displayName = value.value;
        }
        return target;
      case "component-reference": {
        const type = target.type;
        if (type.kind === "function" || type.kind === "class") {
          this.mutations.record(0);
          type.component.properties.set(propertyName, value);
          return target;
        }
        const displayName =
          value.kind === "primitive" && typeof value.value === "string" ? value.value : null;
        if (type.kind === "stub") {
          if (propertyName === "displayName") {
            type.stub.displayName = displayName;
            type.stub.isNamedByRender = false;
          } else {
            type.stub.properties ??= new Map();
            type.stub.properties.set(propertyName, value);
          }
          return target;
        }
        if (type.kind !== "memo" && type.kind !== "forward-ref" && type.kind !== "lazy")
          return target;
        if (propertyName === "displayName") {
          if (displayName === null) return target;
          if (type.kind === "forward-ref") {
            nameAnonymousInner(type.render, displayName);
            type.component.name ??= type.render.name;
          } else if (type.kind === "memo" && type.inner.kind === "function") {
            nameAnonymousInner(type.inner.component, displayName);
          }
          return componentReference({ ...type, displayName });
        }
        this.mutations.record(0);
        type.properties.set(propertyName, value);
        return target;
      }
      case "branch":
        for (const alternative of target.alternatives) {
          this.assignProperty(alternative, propertyName, value, context);
        }
        return target;
      case "namespace": {
        if (target.module.moduleExports === null) return target;
        const replacement = this.evaluateModuleExport(
          target.module,
          "default",
          context.environment,
        );
        if (
          replacement.kind === "function" ||
          replacement.kind === "class" ||
          replacement.kind === "object"
        ) {
          this.assignProperty(replacement, propertyName, value, context);
        }
        return target;
      }
      case "unknown":
      case "unknown-primitive":
      case "external":
        this.markEscaped(value);
        return target;
      default:
        return target;
    }
  }

  private evaluateTopLevelBindingValue(
    module: ModuleRecord,
    binding: TopLevelBinding,
    context: EvaluationContext,
  ): StaticValue {
    switch (binding.kind) {
      case "variable":
        if (!binding.init) return UNDEFINED_VALUE;
        const helperFunction = getInlineHelperFunction(binding.init);
        return (
          (helperFunction ? getInlineCompilerHelper(binding.name, helperFunction) : null) ??
          this.evaluateExpression(binding.init, context, binding.name)
        );
      case "function":
        return (
          getInlineCompilerHelper(binding.name, binding.node) ??
          this.createFunctionValue(binding.node, context, binding.name)
        );
      case "class":
        return this.createClassValue(binding.node, context, binding.name);
      case "typescript":
        return evaluateTypeScriptDeclaration(this, binding.node, context);
      case "import":
        return this.resolvedSymbolToValue(
          this.graph.resolveImport(binding.binding, module),
          binding.name,
          context.environment,
        );
      case "destructured": {
        const initValue = binding.init
          ? this.evaluateDestructuredInit(binding.init, context)
          : UNDEFINED_VALUE;
        const scratch = createScope(null);
        this.bindPattern(binding.pattern, initValue, scratch, context);
        return scratch.bindings.get(binding.name) ?? UNDEFINED_VALUE;
      }
    }
  }

  private evaluateDestructuredInit(init: Expression, context: EvaluationContext): StaticValue {
    const { destructuredInitValues } = this.getModuleRegistry(context.module, context.environment);
    const cached = destructuredInitValues.get(init);
    if (cached) return cached;
    const value = this.evaluateExpression(init, context, null);
    destructuredInitValues.set(init, value);
    return value;
  }

  createFunctionValue(
    node: FunctionLikeNode,
    context: EvaluationContext,
    nameHint: string | null,
  ): StaticValue {
    const explicitName =
      node.type === "ArrowFunctionExpression" ? null : this.getDeclaredName(node, context.module);
    return {
      kind: "function",
      node,
      scope: context.scope,
      module: context.module,
      thisValue: node.type === "ArrowFunctionExpression" ? context.thisValue : null,
      superBinding: node.type === "ArrowFunctionExpression" ? context.superBinding : null,
      name: explicitName ?? nameHint,
      properties: new Map(),
    };
  }

  private getDeclaredName(node: FunctionNode | Class, module: ModuleRecord): string | null {
    if (!node.id) return null;
    return this.project.transpiler === "esbuild" && ESBUILD_TRANSFORMED_FILE.test(module.filePath)
      ? getEsbuildDeclarationName(module.file.program, node)
      : node.id.name;
  }

  private createClassValue(
    node: Class,
    context: EvaluationContext,
    nameHint: string | null,
  ): StaticValue {
    const superValue = node.superClass
      ? this.evaluateExpression(node.superClass, context, null)
      : null;
    const classValue = this.defineClass(
      node,
      {
        members: collectClassMembers(node, (key) => this.evaluatePropertyKey(key, true, context)),
        superValue,
      },
      context,
      this.getDeclaredName(node, context.module) ?? nameHint,
    );
    return this.decorateClass(node, classValue, context);
  }

  /** Legacy (`transform-decorators-legacy`, TS `experimentalDecorators`) class decorators: innermost first, `decorator(Class) || Class`. */
  private decorateClass(
    node: Class,
    classValue: StaticValue,
    context: EvaluationContext,
  ): StaticValue {
    let decorated = classValue;
    for (const decorator of node.decorators.toReversed()) {
      const decoratorValue = this.evaluateExpression(decorator.expression, context, null);
      const target = decorated;
      const result = this.callValue(
        decoratorValue,
        [target],
        context,
        this.locate(context.module, decorator),
      );
      decorated = mapValue(result, (alternative) =>
        getTruthiness(alternative) === false ? target : alternative,
      );
    }
    return decorated;
  }

  /**
   * Materializes a class as `ClassDefinitionEvaluation` does: the class name is
   * bound in a scope of its own before any element runs, the methods are defined
   * first, and the static fields and `static {}` blocks then run in source order
   * with `this` bound to the class. Static getters are read once, after that.
   */
  defineClass(
    node: Class | FunctionLikeNode,
    body: ClassBody,
    context: EvaluationContext,
    name: string | null,
  ): StaticClassValue {
    const classId =
      node.type === "ClassDeclaration" || node.type === "ClassExpression" ? node.id : null;
    const scope = classId ? createScope(context.scope) : context.scope;
    const classValue: StaticClassValue = {
      kind: "class",
      node,
      body,
      scope,
      module: context.module,
      name,
      properties: new Map(),
    };
    if (classId) declareInScope(scope, classId.name, classValue);
    const staticContext: EvaluationContext = { ...context, scope, thisValue: classValue };
    const staticGetters = new Map<string, StaticFunctionValue>();
    for (const member of body.members) {
      if (!member.isStatic || member.kind === "field" || member.kind === "static-block") continue;
      const functionValue = this.createFunctionValue(
        member.functionNode,
        staticContext,
        member.key,
      );
      if (functionValue.kind !== "function") continue;
      const bound: StaticFunctionValue = {
        ...functionValue,
        thisValue: classValue,
        superBinding: { construct: null, parent: body.superValue },
      };
      if (member.kind === "getter") staticGetters.set(member.key, bound);
      else classValue.properties.set(member.key, bound);
    }
    for (const member of body.members) {
      if (!member.isStatic) continue;
      if (member.kind === "field") {
        classValue.properties.set(
          member.key,
          member.value
            ? this.evaluateExpression(member.value, staticContext, member.key)
            : UNDEFINED_VALUE,
        );
      } else if (member.kind === "static-block") {
        this.evaluateBlock(member.body, staticContext, true);
      }
    }
    for (const [key, getter] of staticGetters) {
      classValue.properties.set(
        key,
        this.callFunction(getter, [], staticContext, { thisValue: classValue }),
      );
    }
    return classValue;
  }

  lookupIdentifier(name: string, context: EvaluationContext): StaticValue {
    const resolved = this.resolveIdentifier(name, context);
    if (resolved) return resolved;
    const runtimeSpecifier = getTransformedRuntimeSpecifier(
      this.project,
      context.module.filePath,
      name,
    );
    if (runtimeSpecifier !== null) return this.importModule(runtimeSpecifier, context, null, true);
    return this.isAbsentGlobal(name, context.environment)
      ? thrownValue(
          `\`${name}\` is not defined`,
          createErrorValue("ReferenceError", [primitiveValue(`${name} is not defined`)], null),
        )
      : unknownValue(`unbound identifier "${name}"`);
  }

  /** The binding, module export, or modeled global `name` denotes; null when nothing in scope defines it. */
  private resolveIdentifier(name: string, context: EvaluationContext): StaticValue | null {
    const scoped = lookupScope(context.scope, name);
    if (scoped) return scoped;
    const moduleValue = this.evaluateModuleBinding(context.module, name, context.environment);
    if (moduleValue) return moduleValue;
    if (context.module.isCommonJs) {
      const exportsValue: StaticValue = {
        kind: "namespace",
        module: context.module,
      };
      if (name === "exports") return exportsValue;
      if (name === "module") return objectFromRecord({ exports: exportsValue });
    }
    const modulePathName = this.getModulePathName(name, context);
    if (modulePathName) return modulePathName;
    const global = this.getGlobal(name, context.environment);
    if (global || context.environment === "server") return global;
    return this.windowGlobals.get(name) ?? null;
  }

  /**
   * An unbound name reading which throws a `ReferenceError` (so `typeof` yields
   * `"undefined"`): the captured page's `window` lacked it, or, with no page
   * captured, only another host declares it. Names a bundler may inject per
   * module (`global`, `define`) are decided by the bundler alone.
   */
  private isAbsentGlobal(name: string, environment: RenderEnvironment | null): boolean {
    if (environment === "server") return this.serverRealm.isForeignGlobal(name);
    if (this.windowGlobals.has(name)) return false;
    if (BUNDLER_INJECTED_NAMES.has(name))
      return isBundlerUndeclaredName(this.project.bundler, name);
    const windowKeys = this.pageState?.windowKeys;
    return windowKeys === undefined
      ? this.clientRealm.isForeignGlobal(name)
      : !windowKeys.includes(name);
  }

  /** A member the captured page's `navigator` lacked (vendor properties such as `userLanguage`). */
  private isAbsentHostMember(
    objectName: string,
    key: string,
    environment: RenderEnvironment | null,
  ): boolean {
    const navigatorKeys = this.pageState?.navigatorKeys;
    return (
      environment !== "server" &&
      navigatorKeys !== undefined &&
      this.getRealm(environment).normalizeGlobalName(objectName) === "navigator" &&
      !navigatorKeys.includes(key)
    );
  }

  private getModulePathName(name: string, context: EvaluationContext): StaticValue | null {
    return this.getRealm(context.environment).platform === SERVER_HOST_PLATFORM
      ? getModulePathName(name, context.module.filePath)
      : null;
  }

  private getGlobal(name: string, renderEnvironment: RenderEnvironment | null): StaticValue | null {
    const defined = this.defines.get(name);
    if (defined) return defined;
    if (isWebpackRequireName(name) && isWebpackBundled(this.project.hasDeclaredDependency)) {
      return { kind: "global", name };
    }
    if (renderEnvironment !== "server" && isBundlerUndeclaredName(this.project.bundler, name)) {
      return null;
    }
    const realm = this.getRealm(renderEnvironment);
    const hostName = realm.normalizeGlobalName(name);
    const observed = realm.hasDocument ? this.getObservedPageMember(hostName) : null;
    if (observed) return observed;
    if (renderEnvironment !== "server") {
      if (hostName === "global" && isWebpackBundled(this.project.hasDeclaredDependency))
        return GLOBAL_OBJECT_VALUE;
      const windowGlobal = this.windowGlobals.get(hostName);
      if (windowGlobal) return windowGlobal;
    }
    if (hostName === "process.cwd" && this.project.rootDirectory !== null) {
      const rootDirectory = this.project.rootDirectory;
      return nativeFunction(hostName, () => primitiveValue(rootDirectory));
    }
    const pageLocationMember = realm.hasGlobal("location")
      ? getPageLocationMember(this.origin, this.history.route, hostName)
      : null;
    const documentBaseUri =
      hostName === "document.baseURI" && renderEnvironment !== "server"
        ? getDocumentBaseUri(this.origin, this.history.route, this.hostDocument)
        : null;
    return (
      pageLocationMember ??
      documentBaseUri ??
      getBuiltinGlobal(hostName, realm, renderEnvironment === "server" ? null : this.hostDocument, {
        declared: this.processEnvironment,
        renderEnvironment,
        definedObjects: this.definedEnvironmentObjects,
        baseUrl: this.project.baseUrl,
        mode: this.project.mode,
      })
    );
  }

  /** Page facts recorded from the running browser: cookies, `window.name`, and the navigator strings. */
  private getObservedPageMember(hostName: string): StaticValue | null {
    if (this.pageState === null) return null;
    switch (hostName) {
      case "document.cookie":
        return primitiveValue(this.pageState.cookie);
      case "name":
        return this.pageState.name === undefined ? null : primitiveValue(this.pageState.name);
      case "navigator.userAgent":
        return this.pageState.userAgent === undefined
          ? null
          : primitiveValue(this.pageState.userAgent);
      case "navigator.language":
        return this.pageState.language === undefined
          ? null
          : primitiveValue(this.pageState.language);
      case "navigator.languages":
        return this.pageState.languages === undefined
          ? null
          : listValue(this.pageState.languages.map((language) => primitiveValue(language)));
      case "navigator.maxTouchPoints":
        return this.pageState.maxTouchPoints === undefined
          ? null
          : primitiveValue(this.pageState.maxTouchPoints);
      default:
        return null;
    }
  }

  private consumeStep(budget: StepBudget, location: SourceLocation | null): boolean {
    if (budget.remaining <= 0) {
      this.report("budget-exhausted", "evaluation step budget exhausted", location, "warning");
      return false;
    }
    budget.remaining--;
    return true;
  }

  evaluateExpression(
    node: Expression,
    context: EvaluationContext,
    nameHint: string | null = null,
  ): StaticValue {
    const location = this.locate(context.module, node);
    if (!this.consumeStep(context.budget, location)) {
      return unknownValue("step budget exhausted", location);
    }
    switch (node.type) {
      case "Literal":
        if ("regex" in node) {
          return {
            kind: "regexp",
            pattern: node.regex.pattern,
            flags: node.regex.flags,
            lastIndex: 0,
          };
        }
        return primitiveValue(node.value);
      case "TemplateLiteral":
        return this.evaluateTemplateLiteral(node, context);
      case "Identifier":
        if (node.name === "undefined") return UNDEFINED_VALUE;
        return this.lookupIdentifier(node.name, context);
      case "ThisExpression":
        return context.thisValue ?? this.evaluateUnboundThis(context, location);
      case "ArrayExpression":
        return this.evaluateArrayExpression(node, context);
      case "ObjectExpression":
        return this.evaluateObjectExpression(node, context);
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "FunctionDeclaration":
        return this.createFunctionValue(node, context, nameHint);
      case "TSDeclareFunction":
      case "TSEmptyBodyFunctionExpression":
        return unknownValue("function without a body", location);
      case "ClassExpression":
      case "ClassDeclaration":
        return this.createClassValue(node, context, nameHint);
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
      case "TSInstantiationExpression":
      case "ParenthesizedExpression":
        return this.evaluateExpression(node.expression, context, nameHint);
      case "ChainExpression":
        return completeChain(this.evaluateExpression(node.expression, context, nameHint));
      case "SequenceExpression": {
        const lastIndex = node.expressions.length - 1;
        for (const expression of node.expressions.slice(0, lastIndex)) {
          this.evaluateExpression(expression, context);
        }
        return this.evaluateExpression(node.expressions[lastIndex], context);
      }
      case "AwaitExpression": {
        const resolved = this.takeResolvedAwait(node);
        if (resolved) return resolved;
        const operand = this.evaluateExpression(node.argument, context, nameHint);
        const awaited = awaitedValue(operand, location, () => this.timers.drainMicrotasks());
        if (context.hooks && isAwaitDeferred(operand, awaited)) context.hooks.isDeferred = true;
        return awaited;
      }
      case "MemberExpression":
        return this.evaluateMemberExpression(node, context);
      case "CallExpression":
        return this.evaluateCallExpression(node, context, nameHint);
      case "NewExpression":
        return this.evaluateNewExpression(node, context);
      case "ConditionalExpression": {
        const test = this.evaluateExpression(node.test, context);
        const truthiness = getTruthiness(test);
        if (truthiness === true) return this.evaluateExpression(node.consequent, context);
        if (truthiness === false) return this.evaluateExpression(node.alternate, context);
        const reason = `conditional on ${describeValue(test)}`;
        const preferredSide = getPreferredTruthiness(test) === false ? 1 : 0;
        const predicate = getTruthinessPredicate(test);
        const [consequent, alternate] = this.evaluateTestedPaths(
          node.test,
          context,
          () => this.evaluateExpression(node.consequent, context),
          () => this.evaluateExpression(node.alternate, context),
          reason,
          location,
          preferredSide,
          predicate,
        );
        if (!consequent) return alternate ?? UNDEFINED_VALUE;
        if (!alternate) return consequent;
        return branchValue([consequent, alternate], reason, location, preferredSide, predicate);
      }
      case "LogicalExpression":
        return this.evaluateLogicalExpression(node, context);
      case "UnaryExpression":
        return this.evaluateUnaryExpression(node, context);
      case "BinaryExpression":
        return this.evaluateBinaryExpression(node, context);
      case "AssignmentExpression":
        return this.evaluateAssignmentExpression(node, context);
      case "UpdateExpression":
        return this.evaluateUpdateExpression(node, context);
      case "JSXElement":
        return this.evaluateJsxElement(node, context);
      case "JSXFragment":
        return this.evaluateJsxFragment(node, context);
      case "ImportExpression":
        return resolvedPromiseValue(
          mapValue(this.evaluateExpression(node.source, context), (specifier) =>
            specifier.kind === "primitive" && typeof specifier.value === "string"
              ? this.importModule(specifier.value, context, location, false)
              : unknownValue(`dynamic import with specifier ${describeValue(specifier)}`, location),
          ),
        );
      case "TaggedTemplateExpression": {
        const tag = this.withStyledDisplayName(
          this.evaluateExpression(node.tag, context),
          node,
          context,
        );
        if (tag.kind === "external") {
          return {
            ...tag,
            importedName: `${tag.importedName}\`\``,
            origin: "derived",
          };
        }
        const strings = listValue(
          node.quasi.quasis.map((quasi) => primitiveValue(quasi.value.cooked ?? quasi.value.raw)),
        );
        const values = node.quasi.expressions.map((expression) =>
          this.evaluateExpression(expression, context),
        );
        const templateArgumentNames = node.quasi.expressions.map((expression) =>
          expression.type === "Identifier" ? expression.name : null,
        );
        return this.callValue(tag, [strings, ...values], context, location, {
          nameHint,
          templateArgumentNames,
        });
      }
      case "MetaProperty": {
        const name = `${node.meta.name}.${node.property.name}`;
        return this.getGlobal(name, context.environment) ?? unknownValue(name, location);
      }
      case "Super":
        return getSuperObject(this, context, location);
      case "YieldExpression": {
        const yields = this.generatorYields.at(-1);
        const argument = node.argument
          ? this.evaluateExpression(node.argument, context)
          : UNDEFINED_VALUE;
        if (yields === undefined) return unknownValue("yield outside a generator", location);
        if (node.delegate)
          yields.push(
            ...spreadListItems(this.resolveIterable(argument, context, location), location),
          );
        else yields.push(argument);
        return unknownValue("value sent to the generator", location);
      }
      case "V8IntrinsicExpression":
        return unknownValue(`unsupported expression ${node.type}`, location);
    }
  }

  private evaluateTemplateLiteral(node: TemplateLiteral, context: EvaluationContext): StaticValue {
    return node.quasis.reduce<StaticValue>((text, quasi, index) => {
      const quasiText = primitiveValue(quasi.value.cooked ?? quasi.value.raw);
      const withQuasi = applyBinaryOperator("+", text, quasiText);
      const expression = node.expressions[index];
      return expression
        ? applyBinaryOperator("+", withQuasi, this.evaluateExpression(expression, context))
        : withQuasi;
    }, primitiveValue(""));
  }

  private evaluateArrayExpression(node: ArrayExpression, context: EvaluationContext): StaticValue {
    const items: StaticValue[] = [];
    for (const element of node.elements) {
      if (element === null) {
        items.push(UNDEFINED_VALUE);
        continue;
      }
      if (element.type === "SpreadElement") {
        const location = this.locate(context.module, element);
        const spread = this.evaluateExpression(element.argument, context);
        items.push(...spreadListItems(this.resolveIterable(spread, context, location), location));
        continue;
      }
      items.push(this.evaluateExpression(element, context));
    }
    return listValue(items);
  }

  /**
   * What `for..of`, spread, `Array.from` and array destructuring draw from:
   * a collection's or generator's items, the values an object's own
   * `[Symbol.iterator]()` yields through `next()`, or the value itself when it
   * is not such an object.
   */
  resolveIterable(
    value: StaticValue,
    context: EvaluationContext,
    location: SourceLocation | null,
  ): StaticValue {
    const items = getCollectionItems(value);
    if (items) return items;
    if (value.kind !== "object") return value;
    const iteratorMethod = this.getProperty(value, ITERATOR_PROPERTY_KEY, context, location);
    if (!isCallable(iteratorMethod)) return value;
    const iterator = this.callValue(iteratorMethod, [], context, location, { thisValue: value });
    if (iterator.kind === "list") return iterator;
    return (
      getCollectionItems(iterator) ??
      this.drainIterator(iterator, context, location) ??
      unknownValue(`iteration of ${describeValue(value)}`, location)
    );
  }

  /** Calls `next()` until `done`; null when a step's shape or `done` is uncertain. */
  private drainIterator(
    iterator: StaticValue,
    context: EvaluationContext,
    location: SourceLocation | null,
  ): StaticValue | null {
    if (iterator.kind !== "object") return null;
    const next = this.getProperty(iterator, "next", context, location);
    if (!isCallable(next)) return null;
    const items: StaticValue[] = [];
    while (items.length <= MAX_ITERATOR_STEPS) {
      const result = this.callValue(next, [], context, location, { thisValue: iterator });
      if (result.kind !== "object") return null;
      const isDone = getTruthiness(this.getProperty(result, "done", context, location));
      if (isDone === null) return null;
      if (isDone) return listValue(items);
      items.push(this.getProperty(result, "value", context, location));
    }
    return null;
  }

  /** Mutating a value that predates an enclosing fork must be undone for the fork's other paths. */
  recordHeapMutation(target: MutableHeapValue): void {
    this.mutations.record(target.allocation ?? 0);
    if (target.kind === "list") {
      forgetThrowCertainty(target);
      this.escapeWalk.memo.invalidate(target, null);
    }
    this.journalHeapValue(target);
  }

  private journalHeapValue(target: MutableHeapValue): void {
    for (let index = this.heapJournals.length - 1; index >= 0; index--) {
      const journal = this.heapJournals[index];
      if (!journal.isPreexisting(target)) return;
      journal.record(target);
    }
  }

  /** The first root render on the current path wins; later `root.render` calls re-render the same root. */
  recordRootRender(element: StaticValue): void {
    if (this.rootRender.element !== null) return;
    this.recordStateMutation(this.rootRender);
    this.rootRender.element = element;
  }

  recordStateMutation(state: JournaledState<unknown>): void {
    this.mutations.record(state.allocation);
    for (let index = this.heapJournals.length - 1; index >= 0; index--) {
      const journal = this.heapJournals[index];
      if (!journal.isPreexisting(state)) return;
      journal.recordState(state);
    }
  }

  /** A state update queued on one path of an enclosing fork is pending on that path only. */
  recordStateUpdate(cell: StateCell): void {
    this.mutations.record(0);
    for (const journal of this.heapJournals) journal.recordStateUpdate(cell);
  }

  private evaluatePropertyKey(
    key: PropertyKey,
    computed: boolean,
    context: EvaluationContext,
  ): string | null {
    if (!computed) {
      if (key.type === "Identifier") return key.name;
      if (key.type === "Literal" && !("regex" in key)) return String(key.value);
      if (key.type === "PrivateIdentifier") return `#${key.name}`;
    }
    if (key.type === "PrivateIdentifier") return `#${key.name}`;
    return toPropertyKey(this.evaluateExpression(key, context));
  }

  private evaluateObjectExpression(
    node: ObjectExpression,
    context: EvaluationContext,
  ): StaticValue {
    const entries: StaticObjectEntry[] = [];
    for (const property of node.properties) {
      if (property.type === "SpreadElement") {
        const spread = this.evaluateExpression(property.argument, context);
        const copied = getSpreadEntries(spread);
        if (copied) {
          entries.push(...copied);
          continue;
        }
        entries.push({
          kind: "spread",
          value:
            spread.kind === "namespace"
              ? this.materializeNamespace(spread.module, context.environment)
              : spread,
        });
        continue;
      }
      const key = this.evaluatePropertyKey(property.key, property.computed, context);
      if (key === null) {
        entries.push({
          kind: "spread",
          value: unknownValue("computed property key"),
        });
        continue;
      }
      if (property.kind !== "init") {
        const accessor = this.getAccessorEntry(entries, key, context, property);
        accessor[property.kind] = this.evaluateExpression(property.value, context, key);
        continue;
      }
      entries.push({
        kind: "property",
        key,
        value: this.evaluateExpression(property.value, context, key),
      });
    }
    const object = objectValue(entries);
    return (
      this.reactElementFromObject(object, this.locate(context.module, node), context) ?? object
    );
  }

  private getAccessorEntry(
    entries: StaticObjectEntry[],
    key: string,
    context: EvaluationContext,
    node: ObjectProperty,
  ): StaticAccessor {
    const existing = getObjectAccessor(objectValue(entries), key);
    if (existing) return existing;
    const accessor: StaticAccessor = { get: null, set: null };
    entries.push(accessorEntry(key, accessor, this.locate(context.module, node)));
    return accessor;
  }

  /** A bundled `jsx-runtime` builds elements as plain `{ $$typeof, type, key, ref, props }` literals. */
  private reactElementFromObject(
    object: StaticObjectValue,
    location: SourceLocation | null,
    context: EvaluationContext,
  ): StaticValue | null {
    if (object.entries.some((entry) => entry.kind === "spread")) return null;
    const tag = getObjectProperty(object, "$$typeof");
    if (tag.kind !== "symbol" || !REACT_ELEMENT_SYMBOL_KEYS.has(tag.key)) return null;
    const type = getObjectProperty(object, "type");
    const props = getObjectProperty(object, "props");
    if (type.kind === "primitive" && type.value === undefined) return null;
    const key = getObjectProperty(object, "key");
    const ref = getObjectProperty(object, "ref");
    const elementProps =
      props.kind === "object"
        ? objectValue([...props.entries])
        : objectValue([{ kind: "spread", value: props }]);
    if (isNullish(ref) !== true) {
      elementProps.entries.push({ kind: "property", key: "ref", value: ref });
    }
    return this.createElement(
      type,
      elementProps,
      isNullish(key) === true ? null : key,
      [],
      location,
      null,
      context,
    );
  }

  private evaluateLogicalExpression(
    node: LogicalExpression,
    context: EvaluationContext,
  ): StaticValue {
    const left = this.evaluateExpression(node.left, context);
    const location = this.locate(context.module, node);
    switch (node.operator) {
      case "&&": {
        const truthiness = getTruthiness(left);
        if (truthiness === true) return this.evaluateExpression(node.right, context);
        if (truthiness === false) return left;
        const reason = `&& on ${describeValue(left)}`;
        const preferredSide = getPreferredTruthiness(left) === false ? 1 : 0;
        const predicate = getTruthinessPredicate(left);
        const [right, falsyLeft] = this.evaluateTestedPaths(
          node.left,
          context,
          () => this.evaluateExpression(node.right, context),
          (narrowed) =>
            falsyCounterpart(narrowed ? this.evaluateExpression(node.left, context) : left),
          reason,
          location,
          preferredSide,
          predicate,
        );
        if (!right) return falsyLeft ?? falsyCounterpart(left);
        if (!falsyLeft) return right;
        return logicalOutcome(
          branchValue([right, falsyLeft], reason, location, preferredSide, predicate),
          "&&",
          left,
          right,
        );
      }
      case "||": {
        const truthiness = getTruthiness(left);
        if (truthiness === true) return left;
        if (truthiness === false) return this.evaluateExpression(node.right, context);
        const reason = `|| on ${describeValue(left)}`;
        const preferredSide = getPreferredTruthiness(left) === false ? 1 : 0;
        const predicate = getTruthinessPredicate(left);
        const [truthyLeft, right] = this.evaluateTestedPaths(
          node.left,
          context,
          (narrowed) =>
            truthyCounterpart(narrowed ? this.evaluateExpression(node.left, context) : left),
          () => this.evaluateExpression(node.right, context),
          reason,
          location,
          preferredSide,
          predicate,
        );
        if (!truthyLeft) return right ?? left;
        if (!right) return truthyLeft;
        return logicalOutcome(
          branchValue([truthyLeft, right], reason, location, preferredSide, predicate),
          "||",
          left,
          right,
        );
      }
      case "??": {
        const nullish = isNullish(left);
        if (nullish === false) return left;
        if (nullish === true) return this.evaluateExpression(node.right, context);
        let right: StaticValue | null = null;
        const withRight = (alternative: StaticValue): StaticValue => {
          if (isNullish(alternative) === false) return alternative;
          right ??= this.evaluateExpression(node.right, context);
          return isNullish(alternative) === true
            ? right
            : branchValue(
                [alternative, right],
                `?? on ${describeValue(alternative)}`,
                location,
                0,
                getPresencePredicate(alternative),
              );
        };
        return mapValue(left, withRight);
      }
    }
  }

  /** Runs `run` with the tested target narrowed to what it must be for `test` to hold. */
  runWhenTruthy<Result>(test: Expression, context: EvaluationContext, run: () => Result): Result {
    const narrowing = this.narrowTest(test, context);
    if (!narrowing?.whenTrue) return run();
    return withNarrowedTarget(
      context.scope,
      narrowing.target,
      narrowing.whenTrue,
      (object) => this.journalHeapValue(object),
      run,
    );
  }

  private narrowTest(test: Expression, context: EvaluationContext): TestNarrowing | null {
    const lookup = (target: NarrowingTarget) =>
      lookupNarrowingTarget(context.scope, target, getObjectProperty);
    const journal = (object: StaticObjectValue) => this.journalHeapValue(object);
    return (
      narrowTest(
        test,
        lookup,
        (callee) => this.resolveTestCallee(callee, context),
        (value) => getTypeofValue(value, this.getRealm(context.environment)),
      ) ??
      narrowTestByEvaluation(test, lookup, (name, alternative) =>
        withNarrowedTarget(context.scope, { name, key: null }, alternative, journal, () =>
          this.evaluateExpression(test, context),
        ),
      )
    );
  }

  /** A callee named by identifiers alone (`isValidElement`, `React.isValidElement`, `Array.isArray`) evaluates without side effects. */
  private resolveTestCallee(callee: Expression, context: EvaluationContext): StaticValue | null {
    if (callee.type === "Identifier") return this.evaluateExpression(callee, context);
    if (
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.property.type === "Identifier" &&
      callee.object.type === "Identifier"
    ) {
      return this.evaluateExpression(callee, context);
    }
    return null;
  }

  /**
   * Evaluates the two sides of an uncertain test with the tested identifier
   * narrowed to what it must be on each side; a side the narrowing rules out
   * is `null`. The callbacks receive the narrowed value when there is one.
   * Both sides start from the same state and their states are joined after,
   * so an assignment inside one operand stays conditional.
   */
  private evaluateTestedPaths<Result>(
    test: Expression,
    context: EvaluationContext,
    onTrue: (narrowed: StaticValue | null) => Result,
    onFalse: (narrowed: StaticValue | null) => Result,
    reason: string,
    location: SourceLocation | null,
    preferredSide: number,
    predicate: string,
  ): [Result | null, Result | null] {
    const narrowing = this.narrowTest(test, context);
    if (!narrowing) {
      const [trueResult, falseResult] = this.forkValues(
        context.scope,
        [() => onTrue(null), () => onFalse(null)],
        reason,
        location,
        preferredSide,
        predicate,
      );
      return [trueResult, falseResult];
    }
    const { target, whenTrue, whenFalse } = narrowing;
    const journal = (object: StaticObjectValue) => this.journalHeapValue(object);
    const narrowedSide =
      (value: StaticValue, run: (narrowed: StaticValue | null) => Result) => (): Result =>
        withNarrowedTarget(context.scope, target, value, journal, () => run(value));
    if (whenTrue === null) return [null, whenFalse && narrowedSide(whenFalse, onFalse)()];
    if (whenFalse === null) return [narrowedSide(whenTrue, onTrue)(), null];
    const [trueResult, falseResult] = this.forkValues(
      context.scope,
      [narrowedSide(whenTrue, onTrue), narrowedSide(whenFalse, onFalse)],
      reason,
      location,
      preferredSide,
      predicate,
    );
    return [trueResult, falseResult];
  }

  /**
   * Runs each path from the same scope state and joins the states afterwards
   * (`forkPaths` for expressions): bindings, objects and lists a path changed
   * hold one alternative per path.
   */
  private forkValues<Result>(
    scope: Scope,
    paths: Array<() => Result>,
    reason: string,
    location: SourceLocation | null,
    preferredPath: number,
    predicate: string | null,
  ): Result[] {
    const entrySnapshot = snapshotScopes(scope);
    const journal = new HeapJournal();
    this.heapJournals.push(journal);
    const snapshots: ScopeSnapshot[][] = [];
    try {
      return paths.map((path, pathIndex) => {
        if (pathIndex > 0) restoreScopes(entrySnapshot);
        const result = path();
        snapshots.push(snapshotScopes(scope));
        journal.endPath();
        return result;
      });
    } finally {
      this.heapJournals.pop();
      if (snapshots.length === paths.length) {
        journal.join(reason, location, preferredPath, predicate);
        joinScopes(snapshots, reason, location, preferredPath, predicate);
      }
    }
  }

  /**
   * Calls once per alternative of an uncertain callee or receiver. Each call is
   * a path of its own (`forkValues`), so one alternative's writes do not leak
   * into its siblings and a call that recurs from inside one is cut as
   * non-progressing recursion (`CallFrame.forkDepth`).
   */
  private callAlternatives(
    branch: StaticBranchValue,
    context: EvaluationContext,
    call: (alternative: StaticValue, alternativeContext: EvaluationContext) => StaticValue,
  ): StaticValue {
    const alternativeContext: EvaluationContext = {
      ...context,
      forkDepth: context.forkDepth + 1,
    };
    return joinMappedAlternatives(
      branch,
      this.forkValues(
        context.scope,
        branch.alternatives.map((alternative) => () => call(alternative, alternativeContext)),
        branch.reason,
        branch.location,
        branch.preferredIndex,
        branch.predicate,
      ),
    );
  }

  private evaluateUnaryExpression(node: UnaryExpression, context: EvaluationContext): StaticValue {
    if (node.operator === "delete") return this.evaluateDelete(node.argument, context);
    if (node.operator === "typeof") return this.evaluateTypeof(node.argument, context);
    const argument = this.evaluateExpression(node.argument, context);
    switch (node.operator) {
      case "void":
        return getThrownOperand([argument]) ?? UNDEFINED_VALUE;
      default: {
        const operator = node.operator;
        return mapValue(argument, (alternative) => applyUnaryOperator(operator, alternative));
      }
    }
  }

  /** `this` of a function called without a receiver: the global object in sloppy code, uncertain in strict code we cannot place. */
  private evaluateUnboundThis(
    context: EvaluationContext,
    location: SourceLocation | null,
  ): StaticValue {
    const frame = context.callStack.at(-1);
    const isSloppy =
      context.module.isCommonJs &&
      !context.module.directives.includes(USE_STRICT_DIRECTIVE) &&
      frame !== undefined &&
      frame.node.type !== "ArrowFunctionExpression" &&
      !frame.node.body?.body.some(
        (statement) => "directive" in statement && statement.directive === USE_STRICT_DIRECTIVE,
      );
    return isSloppy
      ? { kind: "global", name: "globalThis" }
      : unknownValue("this outside of a class", location);
  }

  /** `typeof name` does not throw on an undeclared name: it is `"undefined"` when the page has no such global. */
  private evaluateTypeof(argument: Expression, context: EvaluationContext): StaticValue {
    const target = unwrapExpression(argument);
    if (target.type === "Identifier") {
      const resolved = this.resolveIdentifier(target.name, context);
      if (resolved) return getTypeofValue(resolved, this.getRealm(context.environment));
      if (this.isAbsentGlobal(target.name, context.environment)) return primitiveValue("undefined");
    }
    return getTypeofValue(
      this.evaluateExpression(argument, context),
      this.getRealm(context.environment),
    );
  }

  private evaluateDelete(argument: Expression, context: EvaluationContext): StaticValue {
    const target = unwrapExpression(argument);
    if (target.type !== "MemberExpression") {
      return getThrownOperand([this.evaluateExpression(argument, context)]) ?? TRUE_VALUE;
    }
    const object = this.evaluateExpression(target.object, context);
    const key = target.computed
      ? this.evaluateExpression(target.property, context)
      : primitiveValue(target.property.type === "Identifier" ? target.property.name : null);
    const thrown = getThrownOperand([object, key]);
    if (thrown) return thrown;
    for (const alternative of object.kind === "branch" ? object.alternatives : [object]) {
      this.deleteProperty(alternative, key);
    }
    return TRUE_VALUE;
  }

  private deleteProperty(target: StaticValue, key: StaticValue): void {
    const name = toPropertyKey(key);
    switch (target.kind) {
      case "native-object":
        if (name !== null) deleteNativeObjectMember(target, name);
        else if (key.kind === "unknown-primitive") deleteNativeObjectComposedMember(target, key);
        return;
      case "object":
        if (target.isFrozen) return;
        this.recordHeapMutation(target);
        this.escapeWalk.memo.invalidate(target, name);
        if (name !== null) deleteObjectProperty(target, name);
        else
          target.entries.push({
            kind: "spread",
            value: unknownValue(`property ${describeValue(key)} deleted`),
          });
        return;
      case "list": {
        if (target.isFrozen) return;
        const index = name === null ? null : Number(name);
        if (index === null || !Number.isInteger(index)) return;
        if (index >= 0 && index < target.items.length) {
          this.recordHeapMutation(target);
          target.items[index] = UNDEFINED_VALUE;
        }
        return;
      }
      default:
        return;
    }
  }

  private evaluateBinaryExpression(
    node: BinaryExpression | PrivateInExpression,
    context: EvaluationContext,
  ): StaticValue {
    if (node.left.type === "PrivateIdentifier")
      return unknownPrimitiveValue("boolean", "private in");
    const left = this.evaluateExpression(node.left, context);
    const right = this.evaluateExpression(node.right, context);
    if (node.operator === "in") {
      return (
        this.hasGlobalExpando(left, right) ??
        hasProperty(left, right) ??
        this.hasGlobalObjectProperty(left, right, context.environment) ??
        this.hasExternalExport(left, right, context) ??
        applyBinaryOperator("in", left, right)
      );
    }
    return applyBinaryOperator(node.operator, left, right, this.getRealm(context.environment));
  }

  /** `"observable" in Symbol` once the program added the member; open while the assignment itself was uncertain. */
  private hasGlobalExpando(key: StaticValue, target: StaticValue): StaticValue | null {
    if (target.kind !== "global") return null;
    const name = toPropertyKey(key);
    const expando = name === null ? undefined : this.globalExpandos.get(`${target.name}.${name}`);
    if (expando === undefined) return null;
    return expando.kind === "branch" ? null : TRUE_VALUE;
  }

  /** The host document when `value` is the `document` global rendered into on the client. */
  private getHostDocument(
    value: StaticGlobalValue,
    environment: RenderEnvironment | null,
  ): HostDocument | null {
    return value.name === "document" && environment !== "server" ? this.hostDocument : null;
  }

  /**
   * `name in window`: a name the page assigned, one the captured browser exposed, or,
   * without a capture, one the host declares outright (optional members stay open).
   * `name in document` is answered by the host document itself; `name in history`
   * by a member the host declares on the global's interface.
   */
  private hasGlobalObjectProperty(
    key: StaticValue,
    target: StaticValue,
    environment: RenderEnvironment | null,
  ): StaticValue | null {
    if (target.kind !== "global") return null;
    const name = toPropertyKey(key);
    if (name === null) return null;
    const hostDocument = this.getHostDocument(target, environment);
    if (hostDocument !== null) return primitiveValue(hasHostDocumentMember(hostDocument, name));
    const realm = this.getRealm(environment);
    if (!realm.isGlobalAlias(target.name)) {
      const declared = realm.getGlobal(`${target.name}.${name}`);
      return declared !== null && !declared.type.isNullable ? TRUE_VALUE : null;
    }
    if (environment !== "server") {
      if (this.windowGlobals.has(name)) return TRUE_VALUE;
      const windowKeys = this.pageState?.windowKeys;
      if (windowKeys) return primitiveValue(windowKeys.includes(name));
    }
    const declared = realm.getGlobal(name);
    if (declared !== null) return declared.type.isNullable ? null : TRUE_VALUE;
    return realm.isForeignGlobal(name) ? FALSE_VALUE : null;
  }

  /**
   * `name in ns` on an external module's exports: known to exist when the export is
   * modeled (or is the `__esModule` marker), otherwise the package's surface is unknown.
   */
  private hasExternalExport(
    key: StaticValue,
    target: StaticValue,
    context: EvaluationContext,
  ): StaticValue | null {
    if (target.kind !== "external" || target.importedName !== "*" || target.origin !== "binding")
      return null;
    const name = toPropertyKey(key);
    if (name === null) return null;
    const member = this.getProperty(target, name, context, null);
    return member.kind === "external" && member.origin === "binding" ? null : TRUE_VALUE;
  }

  private evaluateUpdateExpression(
    node: UpdateExpression,
    context: EvaluationContext,
  ): StaticValue {
    const target = node.argument;
    const current = this.evaluateExpression(target, context);
    const next =
      current.kind === "primitive" && typeof current.value === "number"
        ? primitiveValue(node.operator === "++" ? current.value + 1 : current.value - 1)
        : unknownPrimitiveValue("number", `${node.operator} on ${describeValue(current)}`);
    this.assignTarget(target, next, context);
    return node.prefix ? next : current;
  }

  private evaluateAssignmentExpression(
    node: AssignmentExpression,
    context: EvaluationContext,
  ): StaticValue {
    const target = node.left;
    const nameHint = target.type === "Identifier" ? target.name : null;
    if (node.operator === "=") {
      const value = this.evaluateExpression(node.right, context, nameHint);
      const certainty = getThrowCertainty(value);
      if (certainty !== "always") {
        this.assignTarget(target, certainty === "never" ? value : withoutThrows(value), context);
      }
      return value;
    }
    if (target.type === "ObjectPattern" || target.type === "ArrayPattern") {
      return unknownValue(`compound assignment ${node.operator} to a pattern`);
    }
    const current = this.evaluateExpression(target, context);
    let value: StaticValue;
    if (node.operator === "||=" || node.operator === "&&=" || node.operator === "??=") {
      const truthiness =
        node.operator === "??="
          ? isNullish(current) === null
            ? null
            : !isNullish(current)
          : getTruthiness(current);
      const keepsCurrent = node.operator === "&&=" ? truthiness === false : truthiness === true;
      if (keepsCurrent) return current;
      const right = this.evaluateExpression(node.right, context, nameHint);
      value =
        truthiness === null
          ? branchValue(
              [current, right],
              `${node.operator} on ${describeValue(current)}`,
              null,
              0,
              node.operator === "??="
                ? getPresencePredicate(current)
                : getTruthinessPredicate(current, node.operator === "&&="),
            )
          : right;
    } else {
      const right = this.evaluateExpression(node.right, context);
      value = applyBinaryOperator(node.operator.slice(0, -1), current, right);
    }
    this.assignTarget(target, value, context);
    return value;
  }

  assignTarget(target: AssignmentTarget, value: StaticValue, context: EvaluationContext): void {
    switch (target.type) {
      case "Identifier":
        this.assignIdentifier(target.name, value, context);
        return;
      case "MemberExpression": {
        const staticKey = getStaticMemberKey(target);
        if (staticKey !== null) {
          this.assignMember(target.object, staticKey, value, context);
        } else if (target.computed) {
          const key = this.evaluateExpression(target.property, context);
          const propertyName = toPropertyKey(key);
          if (propertyName !== null) {
            this.assignMember(target.object, propertyName, value, context);
          } else {
            this.assignDynamicMember(target.object, key, value, context);
          }
        }
        return;
      }
      case "ObjectPattern":
      case "ArrayPattern":
        this.destructure(target, value, context.scope, context, (leaf, leafValue) => {
          if (leaf.type === "Identifier") {
            this.assignIdentifier(leaf.name, leafValue, context);
          } else {
            this.assignTarget(leaf, leafValue, context);
          }
        });
        return;
      default: {
        const unwrapped = unwrapExpression(target);
        if (unwrapped.type === "Identifier" || unwrapped.type === "MemberExpression") {
          this.assignTarget(unwrapped, value, context);
        }
      }
    }
  }

  private assignMember(
    objectNode: Expression,
    key: string,
    value: StaticValue,
    context: EvaluationContext,
  ): void {
    const object = this.evaluateExpression(objectNode, context);
    const reassigned = this.assignProperty(object, key, value, context);
    if (reassigned === object) return;
    if (objectNode.type === "Identifier") {
      this.assignIdentifier(objectNode.name, reassigned, context);
      return;
    }
    if (objectNode.type !== "MemberExpression") return;
    const parentKey = getStaticMemberKey(objectNode);
    if (parentKey !== null) this.assignMember(objectNode.object, parentKey, reassigned, context);
  }

  private assignDynamicMember(
    objectNode: Expression,
    key: StaticValue,
    value: StaticValue,
    context: EvaluationContext,
  ): void {
    const object = this.evaluateExpression(objectNode, context);
    for (const alternative of object.kind === "branch" ? object.alternatives : [object]) {
      if (alternative.kind === "object") this.assignDynamicEntry(alternative, key, value);
      else if (alternative.kind === "native-object" && key.kind === "unknown-primitive")
        setNativeObjectComposedMember(alternative, key, value);
      else if (alternative.kind === "unknown" || alternative.kind === "external")
        this.markEscaped(value);
    }
  }

  setReactApiProperty(
    api: ReactApi,
    key: string,
    value: StaticValue,
    context: EvaluationContext,
  ): void {
    const properties = this.reactApiProperties.get(api) ?? new Map<string, StaticValue>();
    this.reactApiProperties.set(api, properties);
    this.mutations.record(0);
    properties.set(
      key,
      this.withUncertainAssignment(properties.get(key), value, `React.${api}.${key}`, context),
    );
  }

  setGlobalMember(
    target: StaticGlobalValue,
    key: string,
    value: StaticValue,
    context: EvaluationContext,
  ): void {
    const isGlobalObject = this.getRealm(context.environment).isGlobalAlias(target.name);
    const properties = isGlobalObject ? this.windowGlobals : this.globalExpandos;
    const name = isGlobalObject ? `window.${key}` : `${target.name}.${key}`;
    const propertyKey = isGlobalObject ? key : name;
    this.mutations.record(0);
    properties.set(
      propertyKey,
      this.withUncertainAssignment(properties.get(propertyKey), value, name, context),
    );
  }

  assignOwnProperty(target: StaticObjectValue, key: string, value: StaticValue): void {
    if (target.isFrozen) return;
    this.recordHeapMutation(target);
    this.escapeWalk.memo.invalidate(target, key);
    target.entries.push({ kind: "property", key, value });
  }

  pushItems(target: StaticListValue, items: readonly StaticValue[]): void {
    if (target.isFrozen) return;
    this.recordHeapMutation(target);
    target.items.push(...items);
  }

  setItem(target: StaticListValue, index: number, value: StaticValue): void {
    if (target.isFrozen) return;
    this.recordHeapMutation(target);
    setListItem(target, index, value);
  }

  private assignDynamicEntry(
    target: StaticObjectValue,
    key: StaticValue,
    value: StaticValue,
  ): void {
    if (target.isFrozen) return;
    this.recordHeapMutation(target);
    this.escapeWalk.memo.invalidate(target, null);
    target.entries.push({
      kind: "spread",
      value: unknownValue(`property ${describeValue(key)} set to ${describeValue(value)}`),
    });
  }

  private assignIdentifier(name: string, value: StaticValue, context: EvaluationContext): void {
    const owner = findOwningScope(context.scope, name);
    if (owner) {
      this.mutations.record(owner.allocation);
      this.escapeWalk.memo.invalidate(owner, name);
      owner.bindings.set(
        name,
        this.withUncertainAssignment(owner.bindings.get(name), value, name, context),
      );
      return;
    }
    const bindingKind = context.module.bindings.get(name)?.kind;
    if (bindingKind === undefined || bindingKind === "typescript") return;
    const values = this.getModuleValues(context.module, context.environment);
    if (!values.has(name)) this.evaluateModuleBinding(context.module, name, context.environment);
    const previous = values.get(name);
    if (previous === undefined || previous === IN_PROGRESS) return;
    this.mutations.record(0);
    this.escapeWalk.memo.invalidate(context.module, name);
    for (const journal of this.heapJournals) journal.recordModuleBinding(values, name, previous);
    values.set(name, this.withUncertainAssignment(previous, value, name, context));
  }

  private withUncertainAssignment(
    previous: StaticValue | undefined,
    value: StaticValue,
    name: string,
    context: EvaluationContext,
  ): StaticValue {
    if (context.uncertainDepth === 0) return value;
    return branchValue(
      [value, previous ?? UNDEFINED_VALUE],
      `assignment to ${name} in an uncertain path`,
    );
  }

  /**
   * Bundlers substitute a `define`d dotted name (`process.env.NODE_ENV`) in the
   * source text, so its root identifier is never read even where the host lacks it.
   */
  private getInlinedDefine(node: MemberExpression, context: EvaluationContext): StaticValue | null {
    const chain = getMemberChain(node);
    if (chain === null || chain[0] === "this") return null;
    const definedName = chain.join(".");
    const inlined = this.defines.get(definedName) ?? getInlinedNodeEnv(definedName);
    if (inlined === null || inlined === undefined) return null;
    const rootName = chain[0];
    const isBound =
      lookupScope(context.scope, rootName) !== undefined || context.module.bindings.has(rootName);
    return isBound ? null : inlined;
  }

  private evaluateMemberExpression(
    node: MemberExpression,
    context: EvaluationContext,
  ): StaticValue {
    const inlined = this.getInlinedDefine(node, context);
    if (inlined) return inlined;
    const object = this.evaluateExpression(node.object, context);
    const location = this.locate(context.module, node);
    if (node.property.type === "PrivateIdentifier") {
      return this.getProperty(object, `#${node.property.name}`, context, location, node.optional);
    }
    if (!node.computed) {
      return this.getProperty(object, node.property.name, context, location, node.optional);
    }
    const key = this.evaluateExpression(node.property, context);
    const propertyName = toPropertyKey(key);
    if (propertyName !== null) {
      return this.getProperty(object, propertyName, context, location, node.optional);
    }
    if (object === CHAIN_SHORT_CIRCUIT) return object;
    return mapValue(object, (alternative) => this.getDynamicMember(alternative, key, location));
  }

  private getDynamicMember(
    object: StaticValue,
    key: StaticValue,
    location: SourceLocation | null,
  ): StaticValue {
    if (object.kind === "list") {
      const candidates = object.items.filter((item) => item.kind !== "repeat");
      return candidates.length === 0
        ? unknownValue("index into an unknown list", location)
        : branchValue(candidates, "dynamic list index", location);
    }
    if (object.kind === "object") {
      const values = object.entries
        .filter((entry) => entry.kind === "property")
        .map((entry) => entry.value);
      return values.length === 0
        ? unknownValue("dynamic key into an unknown object", location)
        : branchValue(values, "dynamic object key", location);
    }
    if (object.kind === "native-object" && key.kind === "unknown-primitive") {
      return getNativeObjectComposedMember(object, key);
    }
    return unknownValue(`dynamic member access on ${describeValue(object)}`, location);
  }

  private readComponentProperty(
    receiver: StaticValue,
    type: StaticElementType,
    key: string,
    location: SourceLocation | null,
  ): StaticValue {
    switch (type.kind) {
      case "host":
        return key === "length"
          ? primitiveValue(type.tagName.length)
          : prototypeMember(receiver, String.prototype, key);
      case "fragment":
      case "strict-mode":
      case "profiler":
      case "suspense":
      case "suspense-list":
      case "activity":
      case "view-transition":
      case "portal":
        return prototypeMember(receiver, Symbol.prototype, key);
      case "context-provider":
      case "context-consumer":
        if (key === "displayName")
          return type.displayName === null ? UNDEFINED_VALUE : primitiveValue(type.displayName);
        if (CONTEXT_OWN_KEYS.has(key)) return unknownValue(`context.${key}`, location);
        return prototypeMember(receiver, Object.prototype, key);
      case "function":
      case "class": {
        const property = getComponentProperty(type.component, key);
        if (property) return property;
        if (key === "name") return primitiveValue(type.component.name ?? "");
        if (type.kind === "class" || FUNCTION_OWN_KEYS.has(key)) {
          return key === "displayName"
            ? UNDEFINED_VALUE
            : unknownValue(`${type.component.name ?? "component"}.${key}`, location);
        }
        return UNDEFINED_VALUE;
      }
      case "memo":
      case "forward-ref":
      case "lazy": {
        const property = type.properties.get(key);
        if (property) return property;
        if (key === "displayName")
          return type.displayName === null ? UNDEFINED_VALUE : primitiveValue(type.displayName);
        if (key === "$$typeof") return { kind: "symbol", key: WRAPPER_SYMBOL_KEYS[type.kind] };
        if (type.kind === "forward-ref" && key === "render") return type.render;
        if (type.kind === "memo" && key === "type") return componentReference(type.inner);
        if (WRAPPER_OWN_KEYS[type.kind].has(key))
          return unknownValue(`${type.kind}.${key}`, location);
        return UNDEFINED_VALUE;
      }
      case "stub": {
        const property = type.stub.properties?.get(key);
        if (property) return property;
        if (key === "displayName" || key === "name") {
          const ownName = getStubOwnName(type.stub, key);
          return ownName === null ? UNDEFINED_VALUE : primitiveValue(ownName);
        }
        return getStubOwnKeys(type.stub.tag).has(key)
          ? unknownValue(`${getStubDisplayName(type.stub) ?? "stub"}.${key}`, location)
          : UNDEFINED_VALUE;
      }
      default:
        return key === "displayName" || key === "name"
          ? unknownPrimitiveValue("string", "component name")
          : unknownValue(`component property "${key}"`, location);
    }
  }

  getProperty(
    object: StaticValue,
    key: string,
    context: EvaluationContext,
    location: SourceLocation | null,
    optional = false,
  ): StaticValue {
    switch (object.kind) {
      case "branch":
        return mapValue(object, (alternative) =>
          this.getProperty(alternative, key, context, location, optional),
        );
      case "object": {
        const accessor = getObjectAccessor(object, key);
        if (accessor) {
          return accessor.get
            ? this.callValue(accessor.get, [], context, location, {
                thisValue: object,
              })
            : UNDEFINED_VALUE;
        }
        const property = getObjectProperty(object, key);
        if (
          property.kind === "primitive" &&
          property.value === undefined &&
          !object.hasNullPrototype &&
          (OBJECT_PROTOTYPE_METHODS.has(key) ||
            (isPromiseMethodName(key) && getModeledPromise(object)))
        )
          return { kind: "method", receiver: object, name: key };
        return property;
      }
      case "list": {
        const binaryMember = getBinaryMember(object, key);
        if (binaryMember) return binaryMember;
        if (key === "length") return getListLength(object);
        const index = toIndexKey(key);
        if (index !== null) return getListItem(object.items, index, location);
        return (
          object.properties?.get(key) ??
          prototypeMember(object, getBinaryWitness(object) ?? Array.prototype, key)
        );
      }
      case "optional":
        return branchValue(
          [
            this.getProperty(object.value, key, context, location, optional),
            optional ? CHAIN_SHORT_CIRCUIT : UNDEFINED_VALUE,
          ],
          object.reason,
          object.location,
        );
      case "regexp": {
        if (key === "source") return primitiveValue(object.pattern);
        if (key === "flags") return primitiveValue(object.flags);
        if (key === "lastIndex") return primitiveValue(object.lastIndex);
        const flag = REGEXP_FLAG_ACCESSORS.get(key);
        if (flag !== undefined) return primitiveValue(object.flags.includes(flag));
        return prototypeMember(object, RegExp.prototype, key);
      }
      case "symbol":
        if (key === "description") return primitiveValue(getSymbolDescription(object));
        return prototypeMember(object, Symbol.prototype, key);
      case "primitive":
        if (object.value === null || object.value === undefined) {
          if (optional) return CHAIN_SHORT_CIRCUIT;
          return unknownValue(`property "${key}" of ${String(object.value)}`, location);
        }
        if (typeof object.value === "string") {
          if (key === "length") return primitiveValue(object.value.length);
          const index = toIndexKey(key);
          if (index !== null) return primitiveValue(object.value[index]);
        }
        return prototypeMember(object, Object.getPrototypeOf(object.value), key);
      case "unknown-primitive": {
        if (key === "length") {
          return recordDerivation(
            object.primitiveType === "string"
              ? getShapedStringLength(object)
              : unknownPrimitiveValue("number", "length of dynamic value"),
            { kind: "length", operand: object },
          );
        }
        const index = toIndexKey(key);
        if (index !== null && object.primitiveType === "string")
          return getShapedStringCharacter(object, index);
        const witness = getPrimitiveWitness(object.primitiveType);
        return prototypeMember(
          object,
          witness === undefined ? null : Object.getPrototypeOf(Object(witness)),
          key,
        );
      }
      case "context":
        if (key === "Provider") {
          return componentReference({
            kind: "context-provider",
            context: object.context,
            displayName: object.context.displayName,
          });
        }
        if (key === "Consumer") {
          return componentReference({
            kind: "context-consumer",
            context: object.context,
            displayName: object.context.displayName,
          });
        }
        if (key === "displayName") {
          return object.context.displayName === null
            ? UNDEFINED_VALUE
            : primitiveValue(object.context.displayName);
        }
        if (CONTEXT_OWN_KEYS.has(key)) return unknownValue(`context.${key}`, location);
        return prototypeMember(object, Object.prototype, key);
      case "react-api": {
        const defined = this.reactApiProperties.get(object.api)?.get(key);
        if (defined) return defined;
        if (isCallableProtocolKey(key)) return { kind: "method", receiver: object, name: key };
        if (key === "prototype" && isReactComponentBase(object))
          return getReactBasePrototype(object.api);
        const member = resolveReactApiMember(object.api, key);
        if (member) return member;
        if (getReactApiTypeof(object.api) === "function" && !isReactApiFunctionKey(key))
          return UNDEFINED_VALUE;
        return unknownValue(`React.${object.api}.${key}`, location);
      }
      case "external":
        if (object.importedName === "*" && object.origin === "binding") {
          if (key === "__esModule") return TRUE_VALUE;
          return this.resolvedSymbolToValue(
            {
              kind: "external",
              packageName: object.packageName,
              imported: key === "default" ? { kind: "default" } : { kind: "named", name: key },
              specifier: object.specifier,
              filePath: null,
            },
            null,
            context.environment,
          );
        }
        if (object.origin !== "binding" && isModeledOpaqueMethodName(key))
          return { kind: "method", receiver: object, name: key };
        if (object.importedName === "default" && object.origin === "binding") {
          const modeled = this.getModeledExternal(object.specifier, key);
          if (modeled) return modeled;
        }
        if (object.importedName === "*" || object.importedName === "default") {
          const version = this.getReactVersionExport(object.packageName, key);
          if (version) return version;
        }
        const member = getExternalMember(object, key);
        return member.kind === "react-api"
          ? reactApiValue(member.api, context.environment)
          : member;
      case "native-object":
        return getNativeObjectMember(object, key);
      case "namespace":
        return this.getNamespaceMember(object.module, key, context.environment);
      case "global": {
        const storageAreaName = getStorageAreaName(object.name);
        if (storageAreaName !== null) {
          return key === "length"
            ? getStorageLength(this.storageAreas[storageAreaName], storageAreaName)
            : { kind: "method", receiver: object, name: key };
        }
        if (isHistoryName(object.name)) {
          return (
            getHistoryMember(this.history, key) ?? {
              kind: "method",
              receiver: object,
              name: key,
            }
          );
        }
        if (isIndexedDbName(object.name)) return { kind: "method", receiver: object, name: key };
        if (isWebCryptoName(object.name)) {
          return getWebCryptoMember(object.name, key) ?? UNDEFINED_VALUE;
        }
        const memberName = `${object.name}.${key}`;
        if (this.getRealm(context.environment).isGlobalAlias(object.name)) {
          const windowGlobal =
            context.environment === "server" ? undefined : this.windowGlobals.get(key);
          if (windowGlobal) return windowGlobal;
          if (isSymbolPropertyKey(key) || this.isAbsentGlobal(key, context.environment))
            return UNDEFINED_VALUE;
          return (
            this.getGlobal(memberName, context.environment) ?? unknownValue(memberName, location)
          );
        }
        const intrinsic = getBuiltinWitness(object.name);
        if (typeof intrinsic === "function" && (key === "length" || key === "name"))
          return primitiveValue(intrinsic[key]);
        if (
          intrinsic !== null &&
          INTRINSIC_PROTOTYPE_NAMES.has(object.name) &&
          !isSymbolPropertyKey(key) &&
          !hasIntrinsicMember(intrinsic, key)
        ) {
          return UNDEFINED_VALUE;
        }
        const hostDocument = this.getHostDocument(object, context.environment);
        const declaredMember =
          (hostDocument === null ? null : getHostDocumentExpando(hostDocument, key)) ??
          this.getModulePathName(memberName, context) ??
          this.getGlobal(memberName, context.environment);
        if (declaredMember) return declaredMember;
        const expando = this.globalExpandos.get(memberName);
        if (expando) return expando;
        if (this.isAbsentHostMember(object.name, key, context.environment)) return UNDEFINED_VALUE;
        if (intrinsic !== null && !hasIntrinsicMember(intrinsic, key)) return UNDEFINED_VALUE;
        const isOpenMember =
          !isCallableProtocolKey(key) &&
          this.getRealm(context.environment).hasGlobal(object.name) &&
          !isSymbolPropertyKey(key);
        return isOpenMember
          ? unknownValue(memberName, location)
          : { kind: "method", receiver: object, name: key };
      }
      case "element":
        if (key === "props") return object.props;
        if (key === "key") return object.key ?? NULL_VALUE;
        if (key === "ref")
          return mapValue(getObjectProperty(object.props, "ref"), (ref) =>
            ref.kind === "primitive" && ref.value === undefined ? NULL_VALUE : ref,
          );
        if (key === "type") return componentReference(object.type);
        if (key === "$$typeof") return { kind: "symbol", key: this.elementSymbolKey };
        if (!REACT_ELEMENT_OWN_KEYS.has(key)) return UNDEFINED_VALUE;
        return unknownValue(`element.${key}`, location);
      case "function":
      case "class": {
        const property =
          object.kind === "class" ? getStaticProperty(object, key) : object.properties.get(key);
        if (property) return property;
        if (isCallableProtocolKey(key)) return { kind: "method", receiver: object, name: key };
        if (object.kind === "class") {
          if (key === "prototype") return getClassPrototypeObject(this, object, context);
          if (key === "__proto__") return getClassPrototype(object);
          if (key === "length") return primitiveValue(getClassLength(object));
        } else {
          if (key === "prototype") return getFunctionPrototype(object);
          if (key === "length") {
            return primitiveValue(
              Math.max(0, getFunctionLength(object.node) - (object.boundArgs?.length ?? 0)),
            );
          }
        }
        if (key === "displayName") return UNDEFINED_VALUE;
        if (key === "name") return object.name ? primitiveValue(object.name) : primitiveValue("");
        if (
          !isFunctionOwnOrInheritedKey(key) &&
          (object.kind === "function" || hasKnownStaticChain(object))
        )
          return UNDEFINED_VALUE;
        return unknownValue(`${describeValue(object)}.${key}`, location);
      }
      case "component-reference":
        return this.readComponentProperty(object, object.type, key, location);
      case "repeat":
        if (key === "length") {
          return recordDerivation(unknownPrimitiveValue("number", "length of a repeated list"), {
            kind: "length",
            operand: object,
          });
        }
        return { kind: "method", receiver: object, name: key };
      case "method":
      case "native-function": {
        if (key === "call" || key === "apply" || key === "bind")
          return { kind: "method", receiver: object, name: key };
        if (object.kind === "native-function" && object.getOwnProperty) {
          const own = object.getOwnProperty(key);
          if (own) return own;
          if (!isFunctionOwnOrInheritedKey(key)) return UNDEFINED_VALUE;
        }
        return unknownValue(`property "${key}" of ${describeValue(object)}`, location);
      }
      case "proxy": {
        const trap = getObjectProperty(object.handler, "get");
        return trap.kind === "primitive" && trap.value === undefined
          ? this.getProperty(object.target, key, context, location, optional)
          : this.callValue(trap, [object.target, primitiveValue(key), object], context, location);
      }
      case "unknown":
        if (object === CHAIN_SHORT_CIRCUIT || object.thrown) return object;
        if (isModeledOpaqueMethodName(key)) return { kind: "method", receiver: object, name: key };
        return recordDerivation(unknownValue(object.reason, location), {
          kind: "property",
          object,
          key,
        });
    }
  }

  evaluateArguments(args: Argument[], context: EvaluationContext): StaticValue[] {
    const values: StaticValue[] = [];
    for (const argument of args) {
      if (argument.type === "SpreadElement") {
        const evaluated = this.evaluateExpression(argument.argument, context);
        const spread = this.resolveIterable(
          evaluated,
          context,
          this.locate(context.module, argument),
        );
        if (spread.kind === "list" && spread.items.every((item) => item.kind !== "repeat")) {
          values.push(...spread.items);
        } else {
          values.push(unknownValue(`spread argument ${describeValue(spread)}`));
        }
        continue;
      }
      values.push(this.evaluateExpression(argument, context));
    }
    return values;
  }

  /**
   * `import("x")` / `require("x")`. A `require` of a CommonJS module yields its
   * `module.exports` value; everything else yields the module namespace.
   */
  importModule(
    specifier: string,
    context: EvaluationContext,
    location: SourceLocation | null,
    isRequire: boolean,
  ): StaticValue {
    const target = this.graph.resolveImportedModule(specifier, context.module);
    if (isModuleRecord(target)) {
      return isRequire
        ? this.evaluateModuleExports(target, context.environment)
        : { kind: "namespace", module: target };
    }
    if (target.kind === "internal" && isAssetImport(target.filePath, specifier)) {
      return getAssetModuleValue(target.filePath, specifier, { kind: "default" }, this.project);
    }
    if (target.kind === "external" || target.kind === "builtin") {
      const packageName = target.kind === "external" ? target.packageName : target.specifier;
      const filePath = target.kind === "external" ? target.filePath : null;
      if (isRequire) {
        const required = this.purePackages?.getRequired(target.specifier, filePath);
        if (required) return required;
      }
      return this.resolvedSymbolToValue(
        {
          kind: "external",
          packageName,
          imported: { kind: "namespace" },
          specifier: target.specifier,
          filePath,
        },
        null,
        context.environment,
      );
    }
    if (target.kind === "internal") {
      const imported: ImportedName = isRequire ? { kind: "default" } : { kind: "namespace" };
      if (isCssModulePath(target.filePath)) return getCssModuleValue(target.filePath, imported);
      if (isAssetImport(target.filePath, specifier)) {
        return getAssetModuleValue(target.filePath, specifier, imported, this.project);
      }
    }
    return unknownValue(
      target.kind === "unresolved"
        ? `cannot resolve "${specifier}": ${target.error}`
        : `module "${specifier}" was not loaded into the graph`,
      location,
    );
  }

  private getRequireSpecifier(node: CallExpression, context: EvaluationContext): string | null {
    if (node.callee.type !== "Identifier" || node.callee.name !== "require") return null;
    if (node.arguments.length !== 1 || node.arguments[0].type !== "Literal") return null;
    if (typeof node.arguments[0].value !== "string") return null;
    if (lookupScope(context.scope, "require") || context.module.bindings.has("require"))
      return null;
    return node.arguments[0].value;
  }

  private evaluateCallExpression(
    node: CallExpression,
    context: EvaluationContext,
    nameHint: string | null,
  ): StaticValue {
    const location = this.locate(context.module, node);
    const compiled = getCompiledClass(node);
    if (compiled) return this.evaluateCompiledClass(compiled, node, context);
    const requiredSpecifier = this.getRequireSpecifier(node, context);
    if (requiredSpecifier !== null)
      return this.importModule(requiredSpecifier, context, location, true);
    if (node.callee.type === "Super") {
      context.superBinding?.construct?.(this.evaluateArguments(node.arguments, context));
      return UNDEFINED_VALUE;
    }
    let args: StaticValue[] | null = null;
    const callWith = (
      callee: StaticValue,
      thisValue: StaticValue | null,
      callContext: EvaluationContext,
    ): StaticValue => {
      if (callee === CHAIN_SHORT_CIRCUIT) return callee;
      if (node.optional && isNullish(callee) === true) return CHAIN_SHORT_CIRCUIT;
      args ??= this.evaluateArguments(node.arguments, context);
      return this.callValue(
        this.withStyledDisplayName(callee, node, context),
        args,
        callContext,
        location,
        {
          thisValue,
          nameHint,
        },
      );
    };
    if (node.callee.type !== "MemberExpression") {
      return callWith(this.evaluateExpression(node.callee, context), null, context);
    }
    const member = node.callee;
    const receiver = this.evaluateExpression(member.object, context);
    const key =
      member.property.type === "PrivateIdentifier"
        ? primitiveValue(`#${member.property.name}`)
        : member.computed
          ? this.evaluateExpression(member.property, context)
          : primitiveValue(member.property.name);
    const propertyName = toPropertyKey(key);
    const getCallee = (target: StaticValue): StaticValue => {
      if (target === CHAIN_SHORT_CIRCUIT) return target;
      if (member.optional && isNullish(target) === true) return CHAIN_SHORT_CIRCUIT;
      return propertyName === null
        ? unknownValue("computed method call", location)
        : this.getProperty(target, propertyName, context, location, member.optional);
    };
    const receiverOf = (target: StaticValue): StaticValue | null =>
      member.object.type === "Super" ? context.thisValue : target;
    if (receiver.kind !== "branch") {
      const callee = getCallee(receiver);
      return callWith(callee, isReceiverIndependent(callee) ? null : receiverOf(receiver), context);
    }
    const callee = mapValue(receiver, getCallee);
    if (isReceiverIndependent(callee)) return callWith(callee, null, context);
    return this.callAlternatives(receiver, context, (target, alternativeContext) =>
      callWith(getCallee(target), receiverOf(target), alternativeContext),
    );
  }

  callValue(
    callee: StaticValue,
    args: StaticValue[],
    context: EvaluationContext,
    location: SourceLocation | null,
    options: CallValueOptions = {},
  ): StaticValue {
    const thrownArgument = getThrownOperand(args);
    if (thrownArgument) return thrownArgument;
    if (callee.kind === "unknown" && callee.thrown) return callee;
    const thrownPaths = args.flatMap((argument) => getThrownPaths(argument) ?? []);
    if (thrownPaths.length > 0) {
      const settled = this.callValue(callee, args.map(withoutThrows), context, location, options);
      return branchValue([settled, ...thrownPaths], "throwing argument", location);
    }
    switch (callee.kind) {
      case "branch":
        return this.callAlternatives(callee, context, (alternative, alternativeContext) =>
          this.callValue(alternative, args, alternativeContext, location, options),
        );
      case "function":
        return this.callFunction(callee, args, context, {
          thisValue: options.thisValue ?? callee.thisValue,
        });
      case "react-api":
        return evaluateReactApiCall(
          this,
          callee.api,
          args,
          context,
          location,
          options.nameHint ?? null,
        );
      case "method":
        if (callee.receiver.kind === "branch") {
          return this.callAlternatives(callee.receiver, context, (receiver, alternativeContext) =>
            this.callValue({ ...callee, receiver }, args, alternativeContext, location, options),
          );
        }
        return this.callBuiltin(callee, args, context, location);
      case "global":
        return this.callBuiltin(callee, args, context, location);
      case "external":
        this.markEscapes(args);
        return {
          kind: "external",
          packageName: callee.packageName,
          specifier: callee.specifier,
          importedName: `${callee.importedName}()`,
          origin: "derived",
        };
      case "native-function":
        return callee.call(args, {
          readContext: (definition) => context.readContext(definition) ?? definition.defaultValue,
          hooks: null,
          callAwaited: (callee, calleeArgs) =>
            this.callAwaited(callee, calleeArgs, context, location),
          call: (callee, calleeArgs, thisValue) =>
            this.callValue(callee, calleeArgs, context, location, {
              thisValue,
            }),
          callDeferred: (callee, calleeArgs) =>
            this.callDeferred(callee, calleeArgs, context, location),
          captured: (captured, name) => this.captured(captured, name),
          markEscaped: (value) => this.markEscaped(value),
          queueMicrotask: (task) => this.timers.queueMicrotask(task),
          isDeferred: () => this.timers.isDeferred || (context.hooks?.isDeferred ?? false),
          setProperty: (object, key, value) => this.assignOwnProperty(object, key, value),
          project: this.project,
          recordStateMutation: (state) => this.recordStateMutation(state),
          realm: this.getRealm(context.environment),
          pushItems: (list, items) => this.pushItems(list, items),
          setItem: (list, index, value) => this.setItem(list, index, value),
          nameHint: options.nameHint ?? null,
          templateArgumentNames: options.templateArgumentNames ?? null,
          environment: context.environment,
        });
      case "class":
        return unknownValue(`class ${callee.name ?? ""} called without new`, location);
      case "proxy": {
        const trap = getObjectProperty(callee.handler, "apply");
        return trap.kind === "primitive" && trap.value === undefined
          ? this.callValue(callee.target, args, context, location, options)
          : this.callValue(
              trap,
              [callee.target, options.thisValue ?? UNDEFINED_VALUE, listValue(args)],
              context,
              location,
            );
      }
      case "unknown":
        this.markEscapes(args);
        return unknownValue(`call of ${callee.reason}`, location);
      case "primitive":
        return unknownValue(`call of ${String(callee.value)}`, location);
      default:
        this.markEscapes(args);
        return unknownValue(`call of ${describeValue(callee)}`, location);
    }
  }

  /** `callee.withConfig({ displayName })` when the project's styled-components transform names this call site. */
  private withStyledDisplayName(
    callee: StaticValue,
    node: CallExpression | TaggedTemplateExpression,
    context: EvaluationContext,
  ): StaticValue {
    if (callee.kind === "external" || callee.kind === "unknown") return callee;
    const displayName = this.getStyledDisplayNames(context.module).get(node);
    if (displayName === undefined) return callee;
    const location = this.locate(context.module, node);
    const withConfig = this.getProperty(callee, "withConfig", context, location, false);
    const config = objectFromRecord({
      displayName: primitiveValue(displayName),
    });
    return this.callValue(withConfig, [config], context, location, {
      thisValue: callee,
    });
  }

  private getStyledDisplayNames(module: ModuleRecord): Map<Node, string> {
    let displayNames = this.styledDisplayNames.get(module);
    if (!displayNames) {
      const usesMacro = module.imports.some(
        (binding) => binding.specifier === STYLED_COMPONENTS_MACRO_SPECIFIER,
      );
      const transform = usesMacro
        ? DEFAULT_STYLED_COMPONENTS_TRANSFORM
        : isInsideNodeModules(module.filePath)
          ? null
          : this.styledComponentsTransform;
      displayNames = transform ? collectStyledDisplayNames(module, transform) : new Map();
      this.styledDisplayNames.set(module, displayNames);
    }
    return displayNames;
  }

  private callBuiltin(
    callee: Extract<StaticValue, { kind: "method" | "global" }>,
    args: StaticValue[],
    context: EvaluationContext,
    location: SourceLocation | null,
  ): StaticValue {
    const result = evaluateBuiltinCall(this, callee, args, context, location);
    if (result.kind === "unknown") this.markEscapes(args);
    return result;
  }

  private markEscapes(args: StaticValue[]): void {
    for (const argument of args) this.markEscaped(argument);
  }

  /**
   * `value` flows into code the evaluator does not follow (external calls,
   * timers, opaque props): setters it reaches may fire after mount and the
   * containers its closures mutate may hold entries the analysis never saw.
   */
  markEscaped(value: StaticValue): void {
    forEachEscapedCallable(value, this.escapeWalk);
  }

  private readonly escapeWalk: EscapeWalk = {
    visit: (callable, frame) => {
      if (callable.kind === "native-function") callable.onEscape?.(frame?.arguments ?? null);
      else this.markEscapedMutations(callable, frame);
    },
    resolveModuleBinding: (module, name) => this.peekModuleBinding(module, name),
    memo: new EscapeMemo(() =>
      this.timers.queueMicrotask(() => followStaleCallables(this.escapeWalk)),
    ),
  };

  /**
   * Escaped code widens the heap it names through the variables it captures
   * and its module's bindings; an arrow function captures its `this` too.
   * Its arguments and a method's `this` belong to whichever escaped code
   * handed them over; only a method that escaped directly, as a callback or
   * bound method, may widen the `this` it was bound to. Likewise only a
   * callback handed straight to unfollowed code, which may run it at once,
   * rebinds the variables it captures: a closure held by an escaping store
   * or instance runs when its consumer later calls it.
   */
  private markEscapedMutations(
    functionValue: StaticFunctionValue,
    frame: EscapeFrame | null,
  ): void {
    const { module } = functionValue;
    for (const mutation of getEscapedMutations(functionValue.node)) {
      const root = getAccessRoot(mutation.target, mutation.bindings);
      if (isClosureLocal(functionValue, root) || (root === "this" && frame !== null)) continue;
      if (mutation.kind === "rebinding") {
        if (frame !== null) continue;
        const owner = findOwningScope(functionValue.scope, root);
        if (owner) {
          const current = owner.bindings.get(root);
          if (current === undefined) continue;
          const widened = widenEscapedBinding(current, describeEscapedMutation(mutation));
          if (widened === current) continue;
          this.mutations.record(owner.allocation);
          this.escapeWalk.memo.invalidate(owner, root);
          owner.bindings.set(root, widened);
          continue;
        }
        if (module.bindings.get(root)?.kind !== "variable") continue;
        const values = this.getModuleValues(module, null);
        const previous = values.get(root);
        if (previous !== undefined && previous !== IN_PROGRESS) {
          const widened = widenEscapedBinding(previous, describeEscapedMutation(mutation));
          if (widened !== previous) {
            this.mutations.record(0);
            this.escapeWalk.memo.invalidate(module, root);
            for (const journal of this.heapJournals) {
              journal.recordModuleBinding(values, root, previous);
            }
            values.set(root, widened);
          }
        }
        this.rememberEscapedMutation(module, root, mutation);
        continue;
      }
      const resolved = resolveAccessPath(
        functionValue,
        null,
        mutation.target,
        this.escapeWalk,
        mutation.bindings,
      );
      if (resolved.length > 0) {
        for (const value of resolved) markEscapedMutation(value, mutation);
        continue;
      }
      if (mutation.target.length !== 1 || module.bindings.get(root)?.kind !== "variable") continue;
      this.rememberEscapedMutation(module, root, mutation);
    }
  }

  /** Applies `mutation` to the module variable `name` once it is evaluated, or again should it be re-evaluated. */
  private rememberEscapedMutation(
    module: ModuleRecord,
    name: string,
    mutation: EscapedMutation,
  ): void {
    let mutationsByName = this.escapedMutations.get(module.filePath);
    if (!mutationsByName) {
      mutationsByName = new Map();
      this.escapedMutations.set(module.filePath, mutationsByName);
    }
    let mutations = mutationsByName.get(name);
    if (!mutations) {
      mutations = new Set();
      mutationsByName.set(name, mutations);
    }
    mutations.add(mutation);
  }

  private evaluateNewExpression(node: NewExpression, context: EvaluationContext): StaticValue {
    const callee = this.evaluateExpression(node.callee, context);
    const location = this.locate(context.module, node);
    const args = this.evaluateArguments(node.arguments, context);
    return this.construct(callee, args, context, location);
  }

  /** Runs the pending `super(...)` of `instance` when `superClass` is its parent; null when it is not under construction by that parent. */
  constructSuper(
    instance: StaticValue,
    superClass: StaticValue,
    args: StaticValue[],
  ): StaticValue | null {
    if (instance.kind !== "object") return null;
    const binding = this.pendingSuperBindings.get(instance);
    if (!binding?.construct || binding.parent !== superClass) return null;
    binding.construct(args);
    return instance;
  }

  construct(
    callee: StaticValue,
    args: StaticValue[],
    context: EvaluationContext,
    location: SourceLocation | null,
  ): StaticValue {
    if (callee.kind === "global") {
      return evaluateBuiltinCall(this, callee, args, context, location, true);
    }
    if (callee.kind === "native-function") return this.callValue(callee, args, context, location);
    if (callee.kind === "class") return constructClassInstance(this, callee, args, context);
    if (callee.kind === "function")
      return this.constructWithFunction(callee, args, context, location);
    if (callee.kind === "proxy") {
      const trap = getObjectProperty(callee.handler, "construct");
      return trap.kind === "primitive" && trap.value === undefined
        ? this.construct(callee.target, args, context, location)
        : this.callValue(trap, [callee.target, listValue(args), callee], context, location);
    }
    this.markEscapes(args);
    if (callee.kind === "external") {
      return {
        kind: "external",
        packageName: callee.packageName,
        specifier: callee.specifier,
        importedName: `new ${callee.importedName}`,
        origin: "instance",
      };
    }
    return unknownValue(`new ${describeValue(callee)}`, location);
  }

  /** `new fn(...)` on a constructor function: `this` is a fresh object inheriting from `fn.prototype`. */
  private constructWithFunction(
    callee: StaticFunctionValue,
    args: StaticValue[],
    context: EvaluationContext,
    location: SourceLocation | null,
  ): StaticValue {
    const prototype = getFunctionPrototype(callee);
    if (prototype.kind !== "object") {
      this.markEscapes(args);
      return unknownValue(`new ${describeValue(callee)}`, location);
    }
    const instance: StaticObjectValue = { ...objectValue(), prototype };
    const returned = this.callFunction(callee, args, context, {
      thisValue: instance,
    });
    if (returned.kind === "unknown") {
      return returned.thrown
        ? returned
        : unknownValue(
            `new ${describeValue(callee)} whose constructor ${returned.reason}`,
            location,
          );
    }
    return this.getConstructorResult(returned, instance, this.getRealm(context.environment));
  }

  /** `new` yields the constructor's return value only when it is an object or function. */
  private getConstructorResult(
    returned: StaticValue,
    instance: StaticObjectValue,
    realm: HostRealm,
  ): StaticValue {
    if (returned.kind === "branch") {
      return mapValue(returned, (alternative) =>
        this.getConstructorResult(alternative, instance, realm),
      );
    }
    const typeofValue = getTypeofValue(returned, realm);
    const isObjectLike =
      typeofValue.kind === "primitive" &&
      (typeofValue.value === "function" ||
        (typeofValue.value === "object" && returned.kind !== "primitive"));
    return isObjectLike ? returned : instance;
  }

  /**
   * Ticks a repeating interval at the quiescent point the snapshot is taken
   * until it clears itself or a tick changes nothing; an interval still making
   * changes after that leaves the state it touches uncertain.
   */
  runIntervalTicks(
    callback: StaticValue,
    handle: StaticValue,
    context: EvaluationContext,
    location: SourceLocation | null,
    isDeferred: boolean,
  ): void {
    const wasSettled = this.timers.isClockSettled;
    this.timers.isClockSettled = true;
    try {
      for (let tick = 0; tick < MAX_INTERVAL_TICKS; tick++) {
        const changesBefore = this.mutations.changeCount;
        if (isDeferred) this.callDeferred(callback, [], context, location);
        else this.callValue(callback, [], context, location);
        if (this.timers.isCleared(handle) || this.mutations.changeCount === changesBefore) return;
      }
    } finally {
      this.timers.isClockSettled = wasSettled;
    }
    this.markEscaped(callback);
  }

  /** Calls a promise continuation: updates it queues land after the captured commit. */
  callDeferred(
    callee: StaticValue,
    args: StaticValue[],
    context: EvaluationContext,
    location: SourceLocation | null,
  ): StaticValue {
    return this.runDeferred(context, location, () =>
      this.callValue(callee, args, context, location),
    );
  }

  /**
   * Runs a continuation of a promise the analysis cannot see settle. It runs at
   * an unknown time, so like the state updates it queues, the bindings and heap
   * it writes may or may not have changed by the captured commit, untouched
   * preferred.
   */
  private runDeferred<Result>(
    context: EvaluationContext,
    location: SourceLocation | null,
    run: () => Result,
  ): Result {
    return this.timers.runDeferred(() =>
      this.runMaybe(
        context.scope,
        run,
        "continuation of a promise that settles outside the analysis",
        location,
        false,
      ),
    );
  }

  private takeResolvedAwait(node: AwaitExpression): StaticValue | null {
    const resolved = this.resolvedAwaits.get(node) ?? null;
    this.resolvedAwaits.delete(node);
    return resolved;
  }

  /** Evaluates a side-effect-free expression without consuming the resolved `await`s it reads. */
  private peekExpression(expression: Expression, context: EvaluationContext): StaticValue {
    const resolvedAwaits = new Map(this.resolvedAwaits);
    try {
      return this.evaluateExpression(expression, context);
    } finally {
      this.resolvedAwaits = resolvedAwaits;
    }
  }

  /**
   * Evaluates the `await`s a statement reaches before anything it cannot replay.
   * On a promise that is still pending the async body suspends: the statement
   * is re-evaluated with the outcome once the promise settles, and the rest of
   * the list follows, its outcome passing through the enclosing `try`
   * statements before it settles the call's result. Settled outcomes are left
   * for the statement's own evaluation to pick up.
   */
  private suspendOnLeadingAwait(
    statement: Statement,
    context: EvaluationContext,
    resumeStatement: () => StatementOutcome,
  ): boolean {
    const suspension = context.suspension;
    if (!suspension) return false;
    const oracle: LeadingAwaitOracle = {
      getTruthiness: (expression) => getTruthiness(this.peekExpression(expression, context)),
      isNullish: (expression) => isNullish(this.peekExpression(expression, context)),
      isResolved: (awaitNode) => this.resolvedAwaits.has(awaitNode),
    };
    const drainMicrotasks = () => this.timers.drainMicrotasks();
    for (;;) {
      const node = getLeadingAwait(statement, oracle);
      if (!node) return false;
      const location = this.locate(context.module, node);
      const value = this.evaluateExpression(node.argument, context);
      const pending = getPendingPromise(value, drainMicrotasks);
      if (pending) {
        suspendOnPromise(
          suspension.call,
          pending,
          (outcome, isEscaped) => {
            this.resolvedAwaits.set(node, outcome);
            let resumed = isEscaped
              ? this.runDeferred(context, location, resumeStatement)
              : resumeStatement();
            for (const handler of suspension.outcomeHandlers.toReversed()) {
              if (resumed.isSuspended) return null;
              resumed = handler(resumed);
            }
            return resumed.isSuspended ? null : outcomeToReturnValue(resumed, location);
          },
          location,
        );
        return true;
      }
      const awaited = awaitedValue(value, location, drainMicrotasks);
      if (context.hooks && isAwaitDeferred(value, awaited)) context.hooks.isDeferred = true;
      this.resolvedAwaits.set(node, awaited);
    }
  }

  /**
   * Runs the blocks a root render call is nested in (an async `main`, a `load`
   * handler) as their function does: an `await` of a pending promise suspends
   * the rest, which resumes once the event loop settles it, so the element the
   * render receives sees the state those awaits set up. Null when no render is
   * reached even after every queued task ran.
   */
  evaluateNestedRootRender(blocks: Statement[][], context: EvaluationContext): StaticValue | null {
    const evaluateFrom = (index: number, pathContext: EvaluationContext): StatementOutcome =>
      index === blocks.length
        ? COMPLETES
        : this.evaluateBlock(blocks[index], pathContext, false, (nextContext) =>
            evaluateFrom(index + 1, nextContext),
          );
    evaluateFrom(0, {
      ...context,
      suspension: { call: { result: null }, outcomeHandlers: [] },
    });
    this.timers.drainMicrotasks();
    while (this.rootRender.element === null && this.timers.hasTasks()) this.timers.runNextTask();
    return this.rootRender.element;
  }

  /** Calls `callee` as a framework does when it awaits the returned promise. */
  callAwaited(
    callee: StaticValue,
    args: StaticValue[],
    context: EvaluationContext,
    location: SourceLocation | null,
  ): StaticValue {
    if (callee.kind === "function") {
      return this.callFunction(callee, args, context, { awaited: true });
    }
    return this.callValue(callee, args, context, location);
  }

  callFunction(
    functionValue: Extract<StaticValue, { kind: "function" }>,
    args: StaticValue[],
    context: EvaluationContext,
    options: CallOptions = {},
  ): StaticValue {
    const callStack = options.callStack ?? context.callStack;
    const location = this.locate(functionValue.module, functionValue.node);
    if (functionValue.boundArgs || functionValue.boundThis) {
      return this.callFunction(
        { ...functionValue, boundArgs: undefined, boundThis: undefined },
        [...(functionValue.boundArgs ?? []), ...args],
        context,
        { ...options, thisValue: functionValue.boundThis ?? options.thisValue },
      );
    }
    if (callStack.length >= this.maxCallDepth) {
      this.report(
        "max-call-depth",
        `call depth ${this.maxCallDepth} exceeded`,
        location,
        "warning",
      );
      return unknownValue("call depth exceeded", location);
    }
    if (
      isNonProgressingRecursion(
        callStack,
        functionValue,
        args,
        getCallReceiver(functionValue, options),
        this.mutations,
        context.forkDepth,
      )
    ) {
      return unknownValue(
        `recursive call of ${functionValue.name ?? "anonymous function"}`,
        location,
      );
    }
    if (functionValue.node.generator) {
      if (functionValue.node.async) return unknownValue("async generator result", location);
      return this.callGenerator(functionValue, args, context, options);
    }
    const frame = context.hooks;
    const wasDeferred = frame?.isDeferred ?? false;
    const asyncCall: AsyncCall | null = functionValue.node.async ? { result: null } : null;
    const returned = this.evaluateFunctionBody(functionValue, args, context, options, asyncCall);
    const result = asyncCall?.result ? asyncCall.result.value : returned;
    // An async body runs synchronously up to its first `await` of a pending
    // promise; a modeled one resumes it when that settles, an unknown one
    // defers whatever follows. Only a framework-awaited call (server components,
    // route `lazy`) lets what follows count as settled before the captured commit.
    if (options.awaited) return awaitedValue(result, location, () => this.timers.drainMicrotasks());
    if (!asyncCall || asyncCall.result) return result;
    if (frame && frame.isDeferred && !wasDeferred) {
      frame.isDeferred = wasDeferred;
      return escapedPromiseValue();
    }
    return resolvedPromiseValue(result);
  }

  /**
   * A generator body runs eagerly at the call, collecting its `yield`s for the
   * iterator to replay; a throw it would raise on some `next()` surfaces here.
   */
  private callGenerator(
    functionValue: Extract<StaticValue, { kind: "function" }>,
    args: StaticValue[],
    context: EvaluationContext,
    options: CallOptions,
  ): StaticValue {
    const yields: StaticValue[] = [];
    this.generatorYields.push(yields);
    try {
      const returned = this.evaluateFunctionBody(functionValue, args, context, options, null);
      return getThrowCertainty(returned) === "always"
        ? returned
        : createGeneratorValue(yields, withoutThrows(returned));
    } finally {
      this.generatorYields.pop();
    }
  }

  private evaluateFunctionBody(
    functionValue: Extract<StaticValue, { kind: "function" }>,
    args: StaticValue[],
    context: EvaluationContext,
    options: CallOptions,
    asyncCall: AsyncCall | null,
  ): StaticValue {
    const location = this.locate(functionValue.module, functionValue.node);
    const callStack = options.callStack ?? context.callStack;
    const scope = createScope(functionValue.scope);
    const thisValue = getCallReceiver(functionValue, options);
    const callContext: EvaluationContext = {
      module: functionValue.module,
      scope,
      budget: context.budget,
      thisValue,
      superBinding: functionValue.superBinding,
      readContext: context.readContext,
      callStack: [
        ...callStack,
        {
          node: functionValue.node,
          scope: functionValue.scope,
          args,
          thisValue,
          changeCount: this.mutations.changeCount,
          allocation: getAllocationCount(),
          forkDepth: context.forkDepth,
          properties: new Map(functionValue.properties),
        },
      ],
      uncertainDepth: context.uncertainDepth,
      forkDepth: context.forkDepth,
      environment: context.environment,
      hooks: context.hooks,
      suspension: asyncCall ? { call: asyncCall, outcomeHandlers: [] } : null,
    };
    if (functionValue.node.type === "FunctionExpression" && functionValue.node.id) {
      declareInScope(scope, functionValue.node.id.name, functionValue);
    }
    this.bindParameters(functionValue.node.params, args, scope, callContext);
    if (functionValue.node.type !== "ArrowFunctionExpression") {
      declareInScope(scope, "arguments", listValue(args));
    }
    const body = functionValue.node.body;
    if (!body) return UNDEFINED_VALUE;
    if (body.type !== "BlockStatement") {
      return this.evaluateExpression(body, callContext);
    }
    for (const name of getHoistedVarNames(body.body)) {
      if (!scope.bindings.has(name)) declareInScope(scope, name, UNDEFINED_VALUE);
    }
    const outcome = this.evaluateFunctionBlock(body.body, callContext);
    return outcomeToReturnValue(outcome, location);
  }

  /**
   * The wrapper runs once: its parameter is the base class, the constructor is
   * declared as the class itself so helpers such as `_inheritsLoose(X, Base)`
   * see it, and the remaining setup runs for whatever the members close over.
   */
  private evaluateCompiledClass(
    compiled: CompiledClass,
    call: CallExpression,
    context: EvaluationContext,
  ): StaticValue {
    const superValue = this.evaluateArguments(call.arguments, context)[0] ?? null;
    const scope = createScope(context.scope);
    const wrapperContext: EvaluationContext = { ...context, scope };
    this.bindParameters(
      compiled.wrapper.params,
      superValue ? [superValue] : [],
      scope,
      wrapperContext,
    );
    const classValue = this.defineClass(
      compiled.wrapper,
      { members: compiled.members, superValue },
      wrapperContext,
      compiled.name,
    );
    declareInScope(scope, compiled.name, classValue);
    this.evaluateFunctionBlock(compiled.setup, wrapperContext);
    return classValue;
  }

  /** Parameters of a callback whose caller is not analyzed: each argument is unknown. */
  bindUnknownParameters(
    params: ParamPattern[],
    scope: Scope,
    context: EvaluationContext,
    reason: string,
  ): void {
    this.bindParameters(
      params,
      getValueParams(params).map(() => unknownValue(reason)),
      scope,
      context,
    );
  }

  private bindParameters(
    params: ParamPattern[],
    args: StaticValue[],
    scope: Scope,
    context: EvaluationContext,
  ): void {
    getValueParams(params).forEach((param, index) => {
      if (param.type === "RestElement") {
        this.bindPattern(param.argument, listValue(args.slice(index)), scope, context);
        return;
      }
      const pattern = param.type === "TSParameterProperty" ? param.parameter : param;
      this.bindPattern(pattern, args[index] ?? UNDEFINED_VALUE, scope, context);
      if (param.type === "TSParameterProperty") {
        this.assignParameterProperty(pattern, scope, context);
      }
    });
  }

  /** `constructor(public x = 1)` declares `x` and assigns `this.x` when the constructor runs. */
  private assignParameterProperty(
    pattern: BindingPattern,
    scope: Scope,
    context: EvaluationContext,
  ): void {
    const target = pattern.type === "AssignmentPattern" ? pattern.left : pattern;
    if (target.type !== "Identifier" || context.thisValue === null) return;
    const value = lookupScope(scope, target.name);
    if (value) this.assignProperty(context.thisValue, target.name, value, context);
  }

  /** `var` bindings live in the hoisted function scope; `let`/`const` in the current block. */
  bindDeclarator(
    kind: VariableDeclaration["kind"],
    pattern: BindingPattern,
    value: StaticValue,
    context: EvaluationContext,
  ): void {
    this.bindPattern(
      pattern,
      value,
      this.getDeclarationScope(kind, pattern, context.scope),
      context,
    );
  }

  /** Binds the declarator's non-throwing value; returns the initializer when some path of it throws. */
  evaluateDeclarator(
    declaration: VariableDeclaration,
    declarator: VariableDeclarator,
    context: EvaluationContext,
  ): StaticValue | null {
    const nameHint = getDeclaredNameHint(declarator.id);
    const scope = this.getDeclarationScope(declaration.kind, declarator.id, context.scope);
    if (declarator.init) {
      const initializer = this.evaluateExpression(declarator.init, context, nameHint);
      const isThrowing = getThrowCertainty(initializer) !== "never";
      this.bindPattern(
        declarator.id,
        isThrowing ? withoutThrows(initializer) : initializer,
        scope,
        context,
      );
      return isThrowing ? initializer : null;
    }
    if (declaration.kind !== "var" || scope === context.scope) {
      this.bindPattern(declarator.id, UNDEFINED_VALUE, scope, context);
    }
    return null;
  }

  private getDeclarationScope(
    kind: VariableDeclaration["kind"],
    pattern: BindingPattern,
    scope: Scope,
  ): Scope {
    if (kind !== "var") return scope;
    const [firstName] = getPatternNames(pattern);
    return (firstName === undefined ? null : findOwningScope(scope, firstName)) ?? scope;
  }

  bindPattern(
    pattern: BindingPattern,
    value: StaticValue,
    scope: Scope,
    context: EvaluationContext,
  ): void {
    this.destructure(pattern, value, scope, context, (leaf, leafValue) => {
      if (leaf.type === "Identifier") declareInScope(scope, leaf.name, leafValue);
    });
  }

  private destructure(
    pattern: DestructuringPattern,
    value: StaticValue,
    scope: Scope,
    context: EvaluationContext,
    assignLeaf: PatternLeafAssigner,
  ): void {
    const destructure = (innerPattern: DestructuringPattern, innerValue: StaticValue): void =>
      this.destructure(innerPattern, innerValue, scope, context, assignLeaf);
    switch (pattern.type) {
      case "AssignmentPattern": {
        const nullish = isNullish(value);
        const patternName = pattern.left.type === "Identifier" ? pattern.left.name : null;
        if (nullish === true || (value.kind === "primitive" && value.value === undefined)) {
          destructure(
            pattern.left,
            this.evaluateExpression(pattern.right, withScope(context, scope), patternName),
          );
          return;
        }
        if (nullish === false) {
          destructure(pattern.left, value);
          return;
        }
        const fallback = this.evaluateExpression(
          pattern.right,
          withScope(context, scope),
          patternName,
        );
        destructure(
          pattern.left,
          branchValue([fallback, value], `default for ${patternName ?? "pattern"}`),
        );
        return;
      }
      case "ObjectPattern": {
        const usedKeys = new Set<string>();
        for (const property of pattern.properties) {
          if (property.type === "RestElement") {
            const source =
              value.kind === "namespace"
                ? this.materializeNamespace(value.module, context.environment)
                : value;
            destructure(property.argument, omitRestKeys(source, usedKeys));
            continue;
          }
          const key = this.evaluatePropertyKey(
            property.key,
            property.computed,
            withScope(context, scope),
          );
          if (key === null) {
            destructure(property.value, unknownValue("computed destructuring key"));
            continue;
          }
          usedKeys.add(key);
          destructure(property.value, this.getProperty(value, key, context, null, true));
        }
        return;
      }
      case "ArrayPattern": {
        const iterated = this.resolveIterable(value, context, null);
        pattern.elements.forEach((element, index) => {
          if (!element) return;
          if (element.type === "RestElement") {
            const rest =
              iterated.kind === "list" &&
              iterated.items.slice(0, index).every((item) => item.kind !== "repeat")
                ? listValue(iterated.items.slice(index))
                : unknownValue(`rest of ${describeValue(iterated)}`);
            destructure(element.argument, rest);
            return;
          }
          destructure(element, this.getProperty(iterated, String(index), context, null, true));
        });
        return;
      }
      default:
        assignLeaf(pattern, value);
    }
  }

  private hoistDeclarations(statements: Statement[], context: EvaluationContext): void {
    for (const statement of statements) {
      if (statement.type === "FunctionDeclaration" && statement.id) {
        declareInScope(
          context.scope,
          statement.id.name,
          this.createFunctionValue(statement, context, statement.id.name),
        );
      }
    }
  }

  /**
   * Statement lists are evaluated in continuation-passing style: `continuation`
   * is the rest of the enclosing function, so a fork inside a nested block runs
   * everything after it once per path instead of leaking one path's scope state
   * into the parent list.
   */
  evaluateBlock(
    statements: Statement[],
    context: EvaluationContext,
    createChildScope: boolean,
    continuation: StatementContinuation = completeBlock,
  ): StatementOutcome {
    const blockContext = createChildScope
      ? withScope(context, createScope(context.scope))
      : context;
    this.hoistDeclarations(statements, blockContext);
    return this.evaluateStatements(statements, 0, blockContext, continuation);
  }

  private evaluateStatements(
    statements: Statement[],
    startIndex: number,
    context: EvaluationContext,
    continuation: StatementContinuation,
  ): StatementOutcome {
    for (let index = startIndex; index < statements.length; index++) {
      const statement = statements[index];
      const location = this.locate(context.module, statement);
      if (!this.consumeStep(context.budget, location))
        return returnOutcome(unknownValue("step budget exhausted", location));
      const proceed: StatementContinuation = (pathContext) =>
        this.evaluateStatements(
          statements,
          index + 1,
          withScope(pathContext, context.scope),
          continuation,
        );
      if (
        this.suspendOnLeadingAwait(statement, context, () =>
          this.evaluateStatements(statements, index, context, continuation),
        )
      ) {
        return SUSPENDED;
      }
      switch (statement.type) {
        case "ReturnStatement":
          return returnOutcome(
            statement.argument
              ? this.evaluateExpression(statement.argument, context)
              : UNDEFINED_VALUE,
          );
        case "ThrowStatement": {
          const thrownArgument = this.evaluateExpression(statement.argument, context);
          return returnOutcome(thrownValue("component throws", thrownArgument, location));
        }
        case "BreakStatement":
          return jumpOutcome("break", statement.label?.name ?? null);
        case "ContinueStatement":
          return jumpOutcome("continue", statement.label?.name ?? null);
        case "VariableDeclaration": {
          let thrown: StaticValue | null = null;
          for (const declarator of statement.declarations) {
            const initializer = this.evaluateDeclarator(statement, declarator, context);
            const paths = initializer && getThrownPaths(initializer);
            if (!initializer || !paths) continue;
            thrown = thrown ? branchValue([thrown, paths], "declarations", location) : paths;
            if (getThrowCertainty(initializer) === "always") return returnOutcome(thrown);
          }
          if (thrown) return this.propagateThrow(thrown, context, proceed, location);
          break;
        }
        case "FunctionDeclaration":
          break;
        case "ClassDeclaration":
          if (statement.id) {
            declareInScope(
              context.scope,
              statement.id.name,
              this.createClassValue(statement, context, statement.id.name),
            );
          }
          break;
        case "TSEnumDeclaration":
        case "TSModuleDeclaration": {
          const name = getTypeScriptDeclarationName(statement);
          if (name !== null) {
            declareInScope(
              context.scope,
              name,
              evaluateTypeScriptDeclaration(this, statement, context),
            );
          }
          break;
        }
        case "ExpressionStatement": {
          const value = this.evaluateExpression(statement.expression, context);
          if (getThrowCertainty(value) === "always") return returnOutcome(value);
          const thrown = getThrownPaths(value);
          if (thrown) return this.propagateThrow(thrown, context, proceed, location);
          break;
        }
        case "BlockStatement":
          return this.evaluateBlock(statement.body, context, true, proceed);
        case "IfStatement": {
          const test = this.evaluateExpression(statement.test, context);
          const truthiness = getTruthiness(test);
          const alternate = statement.alternate;
          const runConsequent: StatementContinuation = (pathContext) =>
            this.evaluateBlock([statement.consequent], pathContext, true, proceed);
          const runAlternate: StatementContinuation = (pathContext) =>
            alternate
              ? this.evaluateBlock([alternate], pathContext, true, proceed)
              : proceed(pathContext);
          if (truthiness === true) return runConsequent(context);
          if (truthiness === false) return runAlternate(context);
          const narrowing = this.narrowTest(statement.test, context);
          if (narrowing?.whenTrue === null) return runAlternate(context);
          if (narrowing?.whenFalse === null) return runConsequent(context);
          return this.forkPaths(
            [
              (pathContext) => this.evaluateBlock([statement.consequent], pathContext, true),
              (pathContext) =>
                alternate ? this.evaluateBlock([alternate], pathContext, true) : COMPLETES,
            ],
            context,
            proceed,
            `if (${describeValue(test)})`,
            location,
            getPreferredTruthiness(test) === false ? 1 : 0,
            getTruthinessPredicate(test),
            narrowing,
          );
        }
        case "SwitchStatement":
          return this.evaluateSwitch(statement, context, proceed, location);
        case "TryStatement":
          return this.evaluateTry(statement, context, proceed, location);
        case "ForOfStatement":
        case "ForInStatement":
        case "ForStatement":
        case "WhileStatement":
        case "DoWhileStatement": {
          const outcome = evaluateLoop(this, statement, withoutSuspension(context), location);
          if (!outcome.mayComplete) return outcome;
          if (!outcome.returned) break;
          // Loop bodies are not in continuation style: a return on some
          // iterations means the rest of the function may not run.
          const rest = this.runMaybe(
            context.scope,
            () => proceed(withoutSuspension(context)),
            "return inside a loop",
            location,
          );
          return mergeOutcomes(
            [returnOutcome(outcome.returned), rest],
            "return inside a loop",
            location,
          );
        }
        case "LabeledStatement":
          return this.evaluateBlock([statement.body], context, false, proceed);
        default:
          break;
      }
    }
    return continuation(context);
  }

  /** Ends the statement list on the paths that throw `thrown`; the others run the rest. */
  private propagateThrow(
    thrown: StaticValue,
    context: EvaluationContext,
    proceed: StatementContinuation,
    location: SourceLocation,
  ): StatementOutcome {
    return mergeOutcomes(
      [returnOutcome(thrown), proceed(withoutSuspension(context))],
      `${describeValue(thrown)} may be thrown`,
      location,
      1,
    );
  }

  /**
   * Throws raised inside the `try` block run the handler instead of leaving the
   * function; the paths that complete either block continue past the statement.
   */
  private evaluateTry(
    statement: TryStatement,
    context: EvaluationContext,
    proceed: StatementContinuation,
    location: SourceLocation,
  ): StatementOutcome {
    const finalizer = statement.finalizer;
    const finish: StatementContinuation = finalizer
      ? (pathContext) => this.evaluateBlock(finalizer.body, pathContext, true, proceed)
      : proceed;
    const finishExit = (
      outcome: StatementOutcome,
      pathContext: EvaluationContext,
    ): StatementOutcome => {
      if (!finalizer || outcome.mayComplete) return outcome;
      const exit = this.evaluateBlock(finalizer.body, pathContext, true);
      if (!exit.mayComplete) return exit;
      if (exit.returned === null && exit.jump === null) return outcome;
      return mergeOutcomes([outcome, { ...exit, mayComplete: false }], "finally", location);
    };
    const handler = statement.handler;
    const afterBody = (outcome: StatementOutcome): StatementOutcome => {
      const thrown = outcome.returned && handler ? getThrownPaths(outcome.returned) : null;
      if (thrown === null || !handler) {
        if (!outcome.mayComplete) return finishExit(outcome, withoutSuspension(context));
        return mergeOutcomes(
          [{ ...outcome, mayComplete: false }, finish(withoutSuspension(context))],
          "try",
          location,
          1,
        );
      }
      const passes: StatementOutcome = {
        ...outcome,
        returned:
          outcome.returned && getThrowCertainty(outcome.returned) !== "always"
            ? withoutThrows(outcome.returned)
            : null,
      };
      const catches: StatementContinuation = (pathContext) => {
        const handlerContext = withScope(pathContext, createScope(pathContext.scope));
        if (handler.param) {
          this.bindPattern(
            handler.param,
            getCaughtValue(thrown, location),
            handlerContext.scope,
            handlerContext,
          );
        }
        return finishExit(
          this.evaluateBlock(handler.body.body, handlerContext, false),
          handlerContext,
        );
      };
      const isPassFeasible = passes.mayComplete || passes.returned !== null || passes.jump !== null;
      return this.forkPaths(
        isPassFeasible ? [(pathContext) => finishExit(passes, pathContext), catches] : [catches],
        context,
        finish,
        `${describeValue(thrown)} caught`,
        location,
      );
    };
    const outcome = this.evaluateBlock(
      statement.block.body,
      withOutcomeHandler(context, afterBody),
      true,
    );
    return outcome.isSuspended ? outcome : afterBody(outcome);
  }

  /**
   * Runs `run` as code that may or may not execute from the current state (an
   * iteration of a loop whose count is unknown, a callback for an item that
   * may not exist). Reads inside see its own writes; afterwards every binding,
   * object and list it changed holds both the changed and the untouched state,
   * the changed one preferred unless `isLikelyRun` is false. `isRepeated` marks
   * code that may also run more than once.
   */
  runMaybe<Result>(
    scope: Scope,
    run: () => Result,
    reason: string,
    location: SourceLocation | null,
    isLikelyRun = true,
    isRepeated = false,
  ): Result {
    const entrySnapshot = snapshotScopes(scope);
    const journal = new HeapJournal();
    this.heapJournals.push(journal);
    try {
      return run();
    } finally {
      const ranSnapshot = snapshotScopes(scope);
      journal.endPath();
      restoreScopes(entrySnapshot);
      journal.endPath();
      this.removeHeapJournal(journal);
      const preferredPath = isLikelyRun ? 0 : 1;
      const predicate = createPathPredicate(reason, location);
      journal.join(reason, location, preferredPath, predicate, isRepeated);
      joinScopes([ranSnapshot, entrySnapshot], reason, location, preferredPath, predicate);
    }
  }

  /**
   * Runs `run` once more from the state `runMaybe` left behind and discards
   * everything it does, keeping only which bindings it would move again. A
   * binding that still changes is loop-carried (a counter, an accumulator):
   * after an unknown number of iterations it holds none of the enumerated
   * alternatives in particular, so it widens to an unknown of its type.
   */
  widenLoopCarriedBindings(scope: Scope, run: () => void, location: SourceLocation): void {
    const entrySnapshot = snapshotScopes(scope);
    const journal = new HeapJournal();
    const pendingDepth = this.pendingReturnJoins.length;
    this.heapJournals.push(journal);
    try {
      run();
    } finally {
      const ranSnapshot = snapshotScopes(scope);
      for (const pending of this.pendingReturnJoins.splice(pendingDepth)) {
        this.removeHeapJournal(pending.journal);
      }
      journal.endPath();
      this.removeHeapJournal(journal);
      restoreScopes(entrySnapshot);
      widenMovedBindings(entrySnapshot, ranSnapshot, location);
    }
  }

  private removeHeapJournal(journal: HeapJournal): void {
    const index = this.heapJournals.lastIndexOf(journal);
    if (index !== -1) this.heapJournals.splice(index, 1);
  }

  /**
   * When some paths return and the others `break` or `continue`, the loop goes
   * on from the jumping paths alone; the returning paths keep their heap state
   * aside until the function they left settles.
   */
  private deferReturningPaths(
    journal: HeapJournal,
    outcomes: StatementOutcome[],
    preferredOutcome: number,
    reason: string,
    location: SourceLocation,
  ): boolean {
    const jumpingPaths = outcomes.flatMap((outcome, index) =>
      outcome.jump === null ? [] : [index],
    );
    const returningPaths = outcomes.flatMap((outcome, index) =>
      outcome.jump === null ? [index] : [],
    );
    if (jumpingPaths.length === 0 || returningPaths.length === 0) return false;
    const preferredJumping = Math.max(jumpingPaths.indexOf(preferredOutcome), 0);
    journal.continueFrom(jumpingPaths, reason, location, preferredJumping, null);
    const preferredReturning = returningPaths.indexOf(preferredOutcome);
    this.pendingReturnJoins.push({
      journal,
      reason,
      location,
      preferredPath: preferredReturning === -1 ? returningPaths.length : preferredReturning,
    });
    return true;
  }

  /**
   * A path that returned left its locals behind but not the scopes the running
   * activation closed over: the caller observes those in the state the
   * returning path or a surviving one (already joined into the current scope)
   * left them in. Path order is preserved so the join keeps the fork's
   * predicate whenever at most one path survived.
   */
  private joinReturningClosures(
    pathSnapshots: ScopeSnapshot[][],
    returningPaths: number[],
    context: EvaluationContext,
    reason: string,
    location: SourceLocation,
    preferredPath: number,
    predicate: string,
  ): void {
    if (returningPaths.length === 0) return;
    const closureScopes = getClosureScopes(context);
    const toClosureSnapshots = (snapshots: ScopeSnapshot[]): ScopeSnapshot[] =>
      closureScopes === null
        ? snapshots
        : snapshots.filter((snapshot) => closureScopes.has(snapshot.scope));
    const survivingSnapshots = toClosureSnapshots(snapshotScopes(context.scope));
    if (pathSnapshots.length - returningPaths.length <= 1) {
      joinScopes(
        pathSnapshots.map((snapshots, index) =>
          returningPaths.includes(index) ? toClosureSnapshots(snapshots) : survivingSnapshots,
        ),
        reason,
        location,
        preferredPath,
        predicate,
      );
      return;
    }
    const preferredReturning = returningPaths.indexOf(preferredPath);
    joinScopes(
      [
        ...returningPaths.map((index) => toClosureSnapshots(pathSnapshots[index])),
        survivingSnapshots,
      ],
      reason,
      location,
      preferredReturning === -1 ? returningPaths.length : preferredReturning,
      null,
    );
  }

  private settlePendingReturns(depth: number): void {
    for (const pending of this.pendingReturnJoins.splice(depth).reverse()) {
      this.removeHeapJournal(pending.journal);
      pending.journal.endPath();
      pending.journal.join(pending.reason, pending.location, pending.preferredPath, null);
    }
  }

  private evaluateFunctionBlock(
    statements: Statement[],
    context: EvaluationContext,
  ): StatementOutcome {
    const pendingDepth = this.pendingReturnJoins.length;
    const outcome = this.evaluateBlock(statements, context, false);
    this.settlePendingReturns(pendingDepth);
    return outcome;
  }

  /**
   * Runs each path from the same scope state, then joins the states of the
   * paths that complete normally (bindings that differ become branch values,
   * like SSA phis) and continues with the rest of the function exactly once.
   * Paths that jump out of a loop are joined too: the loop then gives up
   * unrolling, so their state is only ever observed as uncertain.
   */
  private forkPaths(
    branches: StatementContinuation[],
    context: EvaluationContext,
    proceed: StatementContinuation,
    reason: string,
    location: SourceLocation,
    preferredBranch = 0,
    predicate = createPathPredicate(reason, location),
    narrowing: TestNarrowing | null = null,
  ): StatementOutcome {
    const isTooDeep = context.forkDepth >= this.maxForkDepth;
    const forkContext: EvaluationContext = {
      ...context,
      forkDepth: context.forkDepth + 1,
      uncertainDepth: context.uncertainDepth + (isTooDeep ? 1 : 0),
      suspension: null,
    };
    const narrowedBinding = narrowing?.target.key === null ? narrowing.target.name : null;
    const narrowedSubject =
      narrowedBinding === null ? undefined : lookupScope(context.scope, narrowedBinding);
    let isSubjectReassigned = false;
    const entrySnapshot = snapshotScopes(context.scope);
    const hookCursor = context.hooks?.cursor ?? 0;
    const pathSnapshots: ScopeSnapshot[][] = [];
    let completedHookCursor = hookCursor;
    const journal = new HeapJournal();
    this.heapJournals.push(journal);
    const outcomes = branches.map((branch, branchIndex) => {
      if (branchIndex > 0) {
        restoreScopes(entrySnapshot);
        if (context.hooks) context.hooks.cursor = hookCursor;
      }
      const narrowed = branchIndex === 0 ? narrowing?.whenTrue : narrowing?.whenFalse;
      if (narrowing && narrowed) {
        applyNarrowing(context.scope, narrowing.target, narrowed, (object) =>
          this.journalHeapValue(object),
        );
      }
      const outcome = branch(forkContext);
      pathSnapshots.push(snapshotScopes(context.scope));
      if (narrowedBinding !== null && lookupScope(context.scope, narrowedBinding) !== narrowed) {
        isSubjectReassigned = true;
      }
      if (outcome.mayComplete) completedHookCursor = context.hooks?.cursor ?? hookCursor;
      journal.endPath();
      return outcome;
    });
    const preferredOutcome = getPreferredOutcome(outcomes, preferredBranch);
    const completingPaths = outcomes.flatMap((outcome, index) =>
      outcome.mayComplete ? [index] : [],
    );
    const jumpingPaths = outcomes.flatMap((outcome, index) => (outcome.mayComplete ? [] : [index]));
    const returningPaths = jumpingPaths.filter((index) => outcomes[index].jump === null);
    const isMixed = completingPaths.length > 0 && jumpingPaths.length > 0;
    if (isMixed) {
      const preferredCompleting = Math.max(completingPaths.indexOf(preferredOutcome), 0);
      journal.continueFrom(completingPaths, reason, location, preferredCompleting, null);
    } else if (!this.deferReturningPaths(journal, outcomes, preferredOutcome, reason, location)) {
      this.removeHeapJournal(journal);
      journal.join(reason, location, preferredOutcome, predicate);
    }
    const joinedSnapshots = pathSnapshots.filter((_, index) => !returningPaths.includes(index));
    if (joinedSnapshots.length > 0) {
      const isJoinedByPredicate = joinedSnapshots.length === branches.length;
      joinScopes(joinedSnapshots, reason, location, 0, isJoinedByPredicate ? predicate : null);
      if (narrowedBinding !== null && narrowedSubject && !isSubjectReassigned) {
        const rejoined = lookupScope(context.scope, narrowedBinding);
        if (rejoined) recordRefinement(rejoined, narrowedSubject);
      }
    }
    const joinReturningClosures = (): void => {
      const isSubjectPreserved =
        narrowedBinding !== null && narrowedSubject !== undefined && !isSubjectReassigned;
      const subjectAfterRest = isSubjectPreserved
        ? completingPaths.length === 0
          ? narrowedSubject
          : lookupScope(context.scope, narrowedBinding)
        : undefined;
      this.joinReturningClosures(
        pathSnapshots,
        returningPaths,
        context,
        reason,
        location,
        preferredOutcome,
        predicate,
      );
      if (narrowedBinding !== null && subjectAfterRest !== undefined) {
        findOwningScope(context.scope, narrowedBinding)?.bindings.set(
          narrowedBinding,
          subjectAfterRest,
        );
      }
    };
    if (completingPaths.length === 0) {
      joinReturningClosures();
      return mergeOutcomes(
        outcomes,
        reason,
        location,
        preferredOutcome,
        outcomes.every(isPureReturn) ? predicate : null,
      );
    }
    if (context.hooks) context.hooks.cursor = completedHookCursor;
    const rest = proceed(context);
    joinReturningClosures();
    if (isMixed) {
      journal.endPath();
      const preferredJumping = jumpingPaths.indexOf(preferredOutcome);
      if (isPureReturn(rest)) {
        journal.continueFrom(
          jumpingPaths.map((_, index) => index),
          reason,
          location,
          Math.max(preferredJumping, 0),
          null,
        );
        this.pendingReturnJoins.push({
          journal,
          reason,
          location,
          preferredPath: preferredJumping === -1 ? 0 : 1,
        });
      } else {
        this.removeHeapJournal(journal);
        journal.join(
          reason,
          location,
          preferredJumping === -1 ? jumpingPaths.length : preferredJumping,
          null,
        );
      }
    }
    const completingPath = completingPaths.length === 1 ? completingPaths[0] : -1;
    const isRestPositional =
      completingPath !== -1 &&
      outcomes.every((outcome, index) =>
        index === completingPath ? isPureCompletion(outcome) : isPureReturn(outcome),
      );
    return mergeOutcomes(
      isRestPositional
        ? outcomes.map((outcome, index) => (index === completingPath ? rest : outcome))
        : [...outcomes.map((outcome) => ({ ...outcome, mayComplete: false })), rest],
      reason,
      location,
      preferredOutcome,
      isRestPositional ? predicate : null,
    );
  }

  private evaluateSwitch(
    statement: SwitchStatement,
    context: EvaluationContext,
    proceed: StatementContinuation,
    location: SourceLocation,
  ): StatementOutcome {
    const discriminant = this.evaluateExpression(statement.discriminant, context);
    const caseValues = statement.cases.map((switchCase) =>
      switchCase.test ? this.evaluateExpression(switchCase.test, context) : null,
    );
    const runCases = (caseIndex: number, switchContext: EvaluationContext): StatementOutcome => {
      if (caseIndex >= statement.cases.length) return COMPLETES;
      return this.evaluateBlock(
        statement.cases[caseIndex].consequent,
        switchContext,
        false,
        (pathContext) => runCases(caseIndex + 1, pathContext),
      );
    };
    const runFrom = (startCase: number, pathContext: EvaluationContext): StatementOutcome => {
      const outcome = runCases(startCase, withScope(pathContext, createScope(pathContext.scope)));
      return outcome.jump === "break" ? { ...outcome, mayComplete: true, jump: null } : outcome;
    };
    const runThenProceed = (startCase: number): StatementOutcome => {
      const outcome = runFrom(startCase, withoutSuspension(context));
      if (!outcome.mayComplete) return outcome;
      const rest = proceed(context);
      return mergeOutcomes(
        [{ ...outcome, mayComplete: false }, rest],
        `switch (${describeValue(discriminant)})`,
        location,
      );
    };
    const defaultIndex = statement.cases.findIndex((switchCase) => switchCase.test === null);
    const realm = this.getRealm(context.environment);
    const getMatchIndex = (value: StaticValue): number | null => {
      for (const [caseIndex, caseValue] of caseValues.entries()) {
        if (caseValue === null) continue;
        const verdict = getTruthiness(applyBinaryOperator("===", value, caseValue, realm));
        if (verdict === true) return caseIndex;
        if (verdict === null) return null;
      }
      return defaultIndex;
    };
    const reason = `switch (${describeValue(discriminant)})`;
    const matchIndex = getMatchIndex(discriminant);
    if (matchIndex !== null) {
      return matchIndex === -1 ? proceed(context) : runThenProceed(matchIndex);
    }
    const runStart = (startCase: number): StatementContinuation =>
      startCase === -1 ? () => COMPLETES : (pathContext) => runFrom(startCase, pathContext);
    const alternativeMatches =
      discriminant.kind === "branch"
        ? discriminant.alternatives.map((alternative) => getMatchIndex(alternative))
        : [];
    const decidedMatches = alternativeMatches.filter((match): match is number => match !== null);
    if (discriminant.kind !== "branch" || decidedMatches.length !== alternativeMatches.length) {
      const branches = statement.cases.map((_, caseIndex) => runStart(caseIndex));
      if (defaultIndex === -1) branches.push(runStart(-1));
      return this.forkPaths(branches, context, proceed, reason, location);
    }
    const startCases = [...new Set(decidedMatches)];
    const targets = getDiscriminantTargets(statement.discriminant).filter(
      (target) => lookupNarrowingTarget(context.scope, target, getObjectProperty) === discriminant,
    );
    const branches = startCases.map((startCase): StatementContinuation => {
      const matching = discriminant.alternatives.filter(
        (_, index) => decidedMatches[index] === startCase,
      );
      return (pathContext) => {
        const narrowed = branchValue(matching, discriminant.reason, discriminant.location);
        for (const target of targets) {
          applyNarrowing(context.scope, target, narrowed, (object) =>
            this.journalHeapValue(object),
          );
        }
        return runStart(startCase)(pathContext);
      };
    });
    const isPositional = startCases.length === decidedMatches.length;
    return this.forkPaths(
      branches,
      context,
      proceed,
      reason,
      location,
      startCases.indexOf(decidedMatches[discriminant.preferredIndex]),
      isPositional && discriminant.predicate
        ? discriminant.predicate
        : createPathPredicate(reason, location),
    );
  }

  private evaluateJsxName(
    name: JSXElementName | JSXMemberExpressionObject,
    context: EvaluationContext,
    isMemberObject = false,
  ): StaticValue {
    switch (name.type) {
      case "JSXIdentifier":
        // Only a bare lowercase tag is a host element; `<ctx.Provider>` looks
        // up `ctx` whatever its case.
        if (!isMemberObject && /^[a-z]/.test(name.name)) return primitiveValue(name.name);
        return this.lookupIdentifier(name.name, context);
      case "JSXNamespacedName":
        return primitiveValue(`${name.namespace.name}:${name.name.name}`);
      case "JSXMemberExpression": {
        const object = this.evaluateJsxName(name.object, context, true);
        return this.getProperty(
          object,
          name.property.name,
          context,
          this.locate(context.module, name),
        );
      }
    }
  }

  private describeJsxName(name: JSXElementName | JSXMemberExpressionObject): string {
    switch (name.type) {
      case "JSXIdentifier":
        return name.name;
      case "JSXNamespacedName":
        return `${name.namespace.name}:${name.name.name}`;
      case "JSXMemberExpression":
        return `${this.describeJsxName(name.object)}.${name.property.name}`;
    }
  }

  private evaluateJsxAttributes(
    attributes: JSXAttributeItem[],
    context: EvaluationContext,
  ): JsxAttributeValues {
    const entries: StaticObjectEntry[] = [];
    let maybeKey: StaticValue = UNDEFINED_VALUE;
    for (const attribute of attributes) {
      if (attribute.type === "JSXSpreadAttribute") {
        entries.push({
          kind: "spread",
          value: this.evaluateExpression(attribute.argument, context),
        });
        continue;
      }
      const name =
        attribute.name.type === "JSXIdentifier"
          ? attribute.name.name
          : `${attribute.name.namespace.name}:${attribute.name.name.name}`;
      let value: StaticValue;
      if (attribute.value === null) {
        value = TRUE_VALUE;
      } else if (attribute.value.type === "Literal") {
        value = primitiveValue(
          typeof attribute.value.value === "string"
            ? decodeJsxEntities(attribute.value.value)
            : attribute.value.value,
        );
      } else if (attribute.value.type === "JSXExpressionContainer") {
        value =
          attribute.value.expression.type === "JSXEmptyExpression"
            ? UNDEFINED_VALUE
            : this.evaluateExpression(attribute.value.expression, context, name);
      } else {
        value = this.evaluateExpression(attribute.value, context, name);
      }
      if (name === "key" && entries.every((entry) => entry.kind === "property")) {
        maybeKey = value;
        continue;
      }
      entries.push({ kind: "property", key: name, value });
    }
    const { entries: propEntries, key } = splitElementKey(entries, maybeKey);
    return { props: objectValue(propEntries), key };
  }

  evaluateJsxChildren(children: JSXChild[], context: EvaluationContext): StaticValue[] {
    const values: StaticValue[] = [];
    for (const child of children) {
      switch (child.type) {
        case "JSXText": {
          const text = decodeJsxEntities(cleanJsxText(child.value));
          if (text) values.push(primitiveValue(text));
          break;
        }
        case "JSXExpressionContainer":
          if (child.expression.type !== "JSXEmptyExpression") {
            values.push(this.evaluateExpression(child.expression, context));
          }
          break;
        case "JSXSpreadChild": {
          const spread = this.evaluateExpression(child.expression, context);
          if (spread.kind === "list") values.push(...spread.items);
          else values.push(unknownValue("spread child"));
          break;
        }
        case "JSXElement":
          values.push(this.evaluateJsxElement(child, context));
          break;
        case "JSXFragment":
          values.push(this.evaluateJsxFragment(child, context));
          break;
      }
    }
    return values;
  }

  createElement(
    type: StaticValue,
    props: StaticObjectValue,
    key: StaticValue | null,
    children: StaticValue[],
    location: SourceLocation | null,
    nameHint: string | null,
    context: EvaluationContext,
  ): StaticValue {
    if (children.length === 1) {
      props.entries.push({
        kind: "property",
        key: "children",
        value: children[0],
      });
    } else if (children.length > 1) {
      props.entries.push({
        kind: "property",
        key: "children",
        value: listValue(children),
      });
    }
    const element = (
      elementType: StaticValue,
      elementKey: StaticValue | null,
    ): StaticElementValue => ({
      kind: "element",
      type: toElementType(elementType, nameHint),
      key: toElementKey(elementKey),
      props,
      location,
      environment: context.environment,
    });
    return mapValue(type, (elementType) =>
      key?.kind === "branch"
        ? mapValue(key, (alternative) => element(elementType, alternative))
        : element(elementType, key),
    );
  }

  private evaluateJsxElement(node: JSXElement, context: EvaluationContext): StaticValue {
    const { props, key } = this.evaluateJsxAttributes(node.openingElement.attributes, context);
    const type =
      this.getStyledJsxType(node.openingElement.name, props) ??
      this.evaluateJsxName(node.openingElement.name, context);
    const children = this.evaluateJsxChildren(node.children, context);
    const factory = this.getJsxFactory(context, this.locate(context.module, node));
    if (factory) {
      return this.callJsxFactory(
        factory,
        type,
        props,
        key,
        children,
        node,
        this.describeJsxName(node.openingElement.name),
        context,
      );
    }
    const expandJsx = getStubExpandJsx(type);
    return this.createElement(
      type,
      expandJsx ? expandJsx(props, describeMacroJsxChildren(node.children, children)) : props,
      key,
      expandJsx ? [] : children,
      this.locate(context.module, node),
      this.describeJsxName(node.openingElement.name),
      context,
    );
  }

  // styled-jsx's compile step rewrites `<style jsx>` into its `JSXStyle`
  // component; the framework model supplies that component when it applies.
  private getStyledJsxType(name: JSXElementName, props: StaticObjectValue): StaticValue | null {
    if (name.type !== "JSXIdentifier" || name.name !== "style") return null;
    const hasJsxAttribute = props.entries.some(
      (entry) => entry.kind === "property" && entry.key === "jsx",
    );
    if (!hasJsxAttribute) return null;
    return this.externalValues?.(STYLED_JSX_SPECIFIER, "default") ?? null;
  }

  private evaluateJsxFragment(node: JSXFragment, context: EvaluationContext): StaticValue {
    const children = this.evaluateJsxChildren(node.children, context);
    const location = this.locate(context.module, node);
    const factory = this.getJsxFactory(context, location);
    if (factory) {
      const pragma = context.module.file.jsxPragma;
      const fragmentType =
        pragma?.fragment && factory.source === "classic"
          ? this.evaluatePragmaMember(pragma.fragment, context, location)
          : REACT_FRAGMENT;
      return this.callJsxFactory(
        factory,
        fragmentType,
        objectValue(),
        null,
        children,
        node,
        "Fragment",
        context,
      );
    }
    return this.createElement(
      REACT_FRAGMENT,
      objectValue(),
      null,
      children,
      location,
      "Fragment",
      context,
    );
  }

  /**
   * The element factory a file's `@jsx` (classic) or `@jsxImportSource`
   * (automatic) annotation routes its JSX through; null when the JSX compiles
   * to React's own `createElement`/`jsx`.
   */
  private getJsxFactory(
    context: EvaluationContext,
    location: SourceLocation | null,
  ): JsxFactory | null {
    const pragma = context.module.file.jsxPragma;
    if (!pragma) return null;
    if (pragma.factory !== null && pragma.runtime !== "automatic") {
      const callee = this.evaluatePragmaMember(pragma.factory, context, location);
      if (callee.kind === "react-api" && callee.api === "createElement") return null;
      return { source: "classic", callee };
    }
    if (
      pragma.importSource !== null &&
      pragma.importSource !== "react" &&
      pragma.runtime !== "classic"
    ) {
      const symbol = this.graph.resolveImportedSymbol(
        `${pragma.importSource}/jsx-runtime`,
        { kind: "named", name: "jsx" },
        context.module,
      );
      return {
        source: "automatic",
        callee: this.resolvedSymbolToValue(symbol, null, context.environment),
      };
    }
    return null;
  }

  private evaluatePragmaMember(
    expression: string,
    context: EvaluationContext,
    location: SourceLocation | null,
  ): StaticValue {
    const [root, ...members] = expression.split(".");
    let value = this.lookupIdentifier(root, context);
    for (const member of members) value = this.getProperty(value, member, context, location);
    return value;
  }

  /** `factory(type, props, ...children)` (classic) or `jsx(type, propsWithChildren, key)` (automatic), as the JSX compiles. */
  private callJsxFactory(
    factory: JsxFactory,
    type: StaticValue,
    props: StaticObjectValue,
    key: StaticValue | null,
    children: StaticValue[],
    node: JSXElement | JSXFragment,
    nameHint: string,
    context: EvaluationContext,
  ): StaticValue {
    const location = this.locate(context.module, node);
    if (factory.source === "classic") {
      if (key) props.entries.push({ kind: "property", key: "key", value: key });
      const propsArgument = props.entries.length === 0 ? NULL_VALUE : props;
      return this.callValue(factory.callee, [type, propsArgument, ...children], context, location, {
        nameHint,
      });
    }
    if (children.length === 1) {
      props.entries.push({
        kind: "property",
        key: "children",
        value: children[0],
      });
    } else if (children.length > 1) {
      props.entries.push({
        kind: "property",
        key: "children",
        value: listValue(children),
      });
    }
    return this.callValue(
      factory.callee,
      [type, props, key ?? UNDEFINED_VALUE],
      context,
      location,
      {
        nameHint,
      },
    );
  }
}

interface ScopeSnapshot {
  scope: Scope;
  bindings: Map<string, StaticValue>;
}

const snapshotScopes = (scope: Scope): ScopeSnapshot[] => {
  const snapshots: ScopeSnapshot[] = [];
  let current: Scope | null = scope;
  while (current && current.parent) {
    snapshots.push({ scope: current, bindings: new Map(current.bindings) });
    current = current.parent;
  }
  return snapshots;
};

/** The scopes the running activation closed over; `null` outside any call, where every scope outlives the path. */
const getClosureScopes = (context: EvaluationContext): Set<Scope> | null => {
  const frame = context.callStack.at(-1);
  if (!frame) return null;
  const scopes = new Set<Scope>();
  for (let current: Scope | null = frame.scope; current; current = current.parent) {
    scopes.add(current);
  }
  return scopes;
};

const restoreScopes = (snapshots: ScopeSnapshot[]): void => {
  for (const snapshot of snapshots) {
    snapshot.scope.bindings.clear();
    for (const [name, value] of snapshot.bindings) snapshot.scope.bindings.set(name, value);
  }
};

/**
 * The name a declaration gives its initializer: the bound identifier, or for
 * `const [value, setValue] = useState()` the first element, as React DevTools
 * names hook state.
 */
const getDeclaredNameHint = (id: BindingPattern): string | null => {
  if (id.type === "Identifier") return id.name;
  if (id.type !== "ArrayPattern") return null;
  const [first] = id.elements;
  return first?.type === "Identifier" ? first.name : null;
};

const widenMovedBindings = (
  entryPath: ScopeSnapshot[],
  ranPath: ScopeSnapshot[],
  location: SourceLocation,
): void => {
  entryPath.forEach((snapshot, scopeIndex) => {
    for (const [name, before] of snapshot.bindings) {
      const after = ranPath[scopeIndex].bindings.get(name);
      if (after === undefined || after === before) continue;
      const joined = branchValue([before, after], "loop-carried value", location);
      if (countAlternatives(joined) === countAlternatives(before)) continue;
      snapshot.scope.bindings.set(name, widenValue(joined, location));
    }
  });
};

const joinScopes = (
  paths: ScopeSnapshot[][],
  reason: string,
  location: SourceLocation | null,
  preferredPath: number,
  predicate: string | null,
): void => {
  const [firstPath, ...otherPaths] = paths;
  firstPath.forEach((snapshot, scopeIndex) => {
    const siblings = otherPaths.map((path) => path[scopeIndex].bindings);
    const names = new Set([
      ...snapshot.bindings.keys(),
      ...siblings.flatMap((bindings) => [...bindings.keys()]),
    ]);
    snapshot.scope.bindings.clear();
    for (const name of names) {
      const values = [snapshot.bindings, ...siblings].map(
        (bindings) => bindings.get(name) ?? UNDEFINED_VALUE,
      );
      snapshot.scope.bindings.set(
        name,
        values.every((value) => value === values[0])
          ? values[0]
          : branchValue(values, reason, location, preferredPath, predicate),
      );
    }
  });
};

const WRAPPER_SYMBOL_KEYS = {
  memo: "react.memo",
  "forward-ref": "react.forward_ref",
  lazy: "react.lazy",
} as const;

const getPrimitiveType = (value: StaticValue): UnknownPrimitiveType | null => {
  if (value.kind === "unknown-primitive") return value.primitiveType;
  if (value.kind !== "primitive") return null;
  const type = typeof value.value;
  return type === "string" || type === "number" || type === "boolean" ? type : null;
};

const widenValue = (value: StaticValue, location: SourceLocation): StaticValue => {
  const alternatives = value.kind === "branch" ? value.alternatives : [value];
  const types = new Set(alternatives.map(getPrimitiveType));
  const [type] = types;
  return types.size === 1 && type
    ? unknownPrimitiveValue(type, "loop-carried value")
    : unknownValue("loop-carried value", location);
};

/**
 * `a && b` / `a || b` whose two outcomes are interchangeable uncertain values
 * joins to one of them; a copy keeps the truth of the whole expression as a
 * formula over both operands instead of claiming it equals one of them.
 */
const logicalOutcome = (
  joined: StaticValue,
  operator: "&&" | "||",
  left: StaticValue,
  right: StaticValue,
): StaticValue => {
  if (joined.kind !== "unknown-primitive" && (joined.kind !== "unknown" || joined.thrown)) {
    return joined;
  }
  return recordDerivation({ ...joined }, { kind: "logical", operator, left, right });
};

const applyUnaryOperator = (
  operator: Exclude<UnaryOperator, "typeof" | "void" | "delete">,
  argument: StaticValue,
): StaticValue => {
  if (getThrownOperand([argument])) return argument;
  switch (operator) {
    case "!": {
      const truthiness = getTruthiness(argument);
      if (truthiness === null) {
        return recordNegation(unknownPrimitiveValue("boolean", "negation of unknown"), argument);
      }
      return truthiness ? FALSE_VALUE : TRUE_VALUE;
    }
    case "-":
      if (argument.kind === "primitive" && typeof argument.value === "number")
        return primitiveValue(-argument.value);
      return unknownPrimitiveValue("number", "unary minus");
    case "+":
      if (argument.kind === "primitive" && typeof argument.value !== "bigint")
        return primitiveValue(Number(argument.value));
      return unknownPrimitiveValue("number", "unary plus");
    case "~":
      if (argument.kind === "primitive" && typeof argument.value === "number")
        return primitiveValue(~argument.value);
      return unknownPrimitiveValue("number", "bitwise not");
  }
};

const applyBinaryOperator = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
  realm: HostRealm | null = null,
): StaticValue => {
  if (operator === "+" && (hasDefiniteItems(left) || hasDefiniteItems(right))) {
    return applyBinaryOperator(
      operator,
      hasDefiniteItems(left) ? toStringValue(left) : left,
      hasDefiniteItems(right) ? toStringValue(right) : right,
      realm,
    );
  }
  const distributed = distributeBinary(left, right, (leftAlternative, rightAlternative) =>
    applyBinaryOperator(operator, leftAlternative, rightAlternative, realm),
  );
  if (distributed) return distributed;
  const thrownOperand = getThrownOperand([left, right]);
  if (thrownOperand) return thrownOperand;
  if (operator === "+" && (left.kind === "regexp" || right.kind === "regexp")) {
    return applyBinaryOperator(operator, toCoercedOperand(left), toCoercedOperand(right), realm);
  }
  if (left.kind === "primitive" && right.kind === "primitive") {
    const computed = computeBinary(operator, left.value, right.value);
    if (computed !== undefined) return computed;
  }
  const equality = compareEquality(operator, left, right, realm);
  if (equality) return equality;
  if (operator === "instanceof") {
    const isInstance = isInstanceOf(left, right);
    if (isInstance !== null) return primitiveValue(isInstance);
  }
  const timed = applyClockOperator(operator, left, right);
  if (timed) return timed;
  const ordered =
    compareNumberRanges(operator, left, right) ?? applyNumberRangeOperator(operator, left, right);
  if (ordered) return ordered;
  switch (operator) {
    case "==":
    case "!=":
    case "===":
    case "!==":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return deriveComparison(
        operator,
        left,
        right,
        unknownPrimitiveValue("boolean", `${operator} on dynamic values`),
      );
    case "instanceof":
    case "in":
      return unknownPrimitiveValue("boolean", `${operator} on dynamic values`);
    case "+": {
      const isString =
        (left.kind === "primitive" && typeof left.value === "string") ||
        (right.kind === "primitive" && typeof right.value === "string") ||
        (left.kind === "unknown-primitive" && left.primitiveType === "string") ||
        (right.kind === "unknown-primitive" && right.primitiveType === "string");
      if (isString) return concatenateStrings(left, right);
      return isNumberValue(left) && isNumberValue(right)
        ? unknownPrimitiveValue("number", "+ on dynamic values")
        : unknownPrimitiveValue("any", "+ on dynamic values");
    }
    default:
      return unknownPrimitiveValue("number", `${operator} on dynamic values`);
  }
};

/** `ToPrimitive` of a RegExp operand: `RegExp.prototype.toString`. */
const toCoercedOperand = (value: StaticValue): StaticValue =>
  value.kind === "regexp" ? primitiveValue(regExpToString(value)) : value;

/** A value that is a number for sure, known or not. */
const isNumberValue = (value: StaticValue): boolean =>
  value.kind === "primitive"
    ? typeof value.value === "number"
    : value.kind === "unknown-primitive" && value.primitiveType === "number";

/** React's dev `displayName` setter on `memo`/`forwardRef` also names an anonymous inner function. */
const nameAnonymousInner = (
  inner: { name: string | null; properties: Map<string, StaticValue> },
  displayName: string,
): void => {
  if (inner.name || inner.properties.has("displayName")) return;
  inner.name = displayName;
  inner.properties.set("displayName", primitiveValue(displayName));
};

const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);

const OBJECT_VALUE_KINDS: ReadonlySet<StaticValue["kind"]> = new Set([
  "element",
  "list",
  "object",
  "function",
  "class",
  "regexp",
  "context",
  "react-api",
  "namespace",
  "native-object",
  "method",
  "native-function",
  "proxy",
]);

const COMPARE_OPERATORS: Partial<Record<string, CompareOperator>> = {
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
};

const MIRRORED_COMPARISONS: Record<CompareOperator, CompareOperator> = {
  "<": ">",
  "<=": ">=",
  ">": "<",
  ">=": "<=",
};

/** Guards are serialized as JSON, where only finite numbers survive. */
const isGuardLiteral = (value: StaticPrimitive): value is GuardLiteral =>
  typeof value !== "bigint" &&
  value !== undefined &&
  (typeof value !== "number" || Number.isFinite(value));

/** Records an undecided comparison of a dynamic operand against a literal as a guard over that operand. */
const deriveComparison = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
  result: StaticUnknownPrimitiveValue,
): StaticValue => {
  const isMirrored = right.kind !== "primitive";
  const [operand, literalSide] = isMirrored ? [right, left] : [left, right];
  if (literalSide.kind !== "primitive") return result;
  const literal = literalSide.value;
  if (EQUALITY_OPERATORS.has(operator)) {
    if (literal !== undefined && !isGuardLiteral(literal)) return result;
    return recordDerivation(result, {
      kind: "equality",
      operand,
      literal,
      isStrict: operator === "===" || operator === "!==",
      isNegated: operator === "!==" || operator === "!=",
    });
  }
  const compareOperator = COMPARE_OPERATORS[operator];
  if (compareOperator === undefined || typeof literal !== "number" || !Number.isFinite(literal)) {
    return result;
  }
  return recordDerivation(result, {
    kind: "comparison",
    operand,
    operator: isMirrored ? MIRRORED_COMPARISONS[compareOperator] : compareOperator,
    literal,
  });
};

/** Loose equality only differs from identity when both sides can coerce; null, undefined and symbols never do. */
const mayCoerce = (value: StaticValue): boolean =>
  value.kind === "primitive"
    ? value.value !== null && value.value !== undefined
    : value.kind !== "symbol";

/** Two objects compare by identity under `==` as well: coercion needs a primitive operand. */
const mayCoerceTogether = (left: StaticValue, right: StaticValue): boolean =>
  mayCoerce(left) &&
  mayCoerce(right) &&
  !(OBJECT_VALUE_KINDS.has(left.kind) && OBJECT_VALUE_KINDS.has(right.kind));

/**
 * React's memo cache sentinel never reaches application values, so comparing
 * it against anything the interpreter cannot see is still a definite answer.
 */
/** Whether a host global equals `undefined`/`null`, once the host fixes its `typeof`. */
const compareGlobalToNullish = (
  global: StaticValue,
  other: StaticValue,
  realm: HostRealm | null,
): boolean | null => {
  if (realm === null || global.kind !== "global" || other.kind !== "primitive") return null;
  if (other.value !== undefined && other.value !== null) return null;
  const globalTypeof = getGlobalTypeof(global.name, realm);
  if (globalTypeof === null) return null;
  return globalTypeof === "undefined" ? other.value === undefined : false;
};

const compareEquality = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
  realm: HostRealm | null,
): StaticValue | null => {
  if (!EQUALITY_OPERATORS.has(operator)) return null;
  const isStrict = operator === "===" || operator === "!==";
  let isEqual =
    compareIdentity(left, right) ??
    compareGlobalToNullish(left, right, realm) ??
    compareGlobalToNullish(right, left, realm);
  if (isEqual === false && !isStrict && mayCoerceTogether(left, right)) isEqual = null;
  if (isEqual === null) {
    const isSentinel = (value: StaticValue): boolean =>
      value.kind === "symbol" && value.key === REACT_MEMO_CACHE_SENTINEL_KEY;
    if (!isSentinel(left) && !isSentinel(right)) return null;
    isEqual = false;
  }
  return primitiveValue(operator === "===" || operator === "==" ? isEqual : !isEqual);
};

const computeBinary = (
  operator: string,
  left: StaticPrimitive,
  right: StaticPrimitive,
): StaticValue | undefined => {
  switch (operator) {
    case "===":
      return primitiveValue(left === right);
    case "!==":
      return primitiveValue(left !== right);
    case "==":
      // eslint-disable-next-line eqeqeq
      return primitiveValue(left == right);
    case "!=":
      // eslint-disable-next-line eqeqeq
      return primitiveValue(left != right);
    default:
      break;
  }
  if (typeof left === "bigint" || typeof right === "bigint") return undefined;
  if (typeof left === "string" || typeof right === "string") {
    if (operator === "+") return primitiveValue(String(left) + String(right));
  }
  if (typeof left === "string" && typeof right === "string") {
    switch (operator) {
      case "<":
        return primitiveValue(left < right);
      case "<=":
        return primitiveValue(left <= right);
      case ">":
        return primitiveValue(left > right);
      case ">=":
        return primitiveValue(left >= right);
      default:
        break;
    }
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  switch (operator) {
    case "+":
      return primitiveValue(leftNumber + rightNumber);
    case "-":
      return primitiveValue(leftNumber - rightNumber);
    case "*":
      return primitiveValue(leftNumber * rightNumber);
    case "/":
      return primitiveValue(leftNumber / rightNumber);
    case "%":
      return primitiveValue(leftNumber % rightNumber);
    case "**":
      return primitiveValue(leftNumber ** rightNumber);
    case "<":
      return primitiveValue(leftNumber < rightNumber);
    case "<=":
      return primitiveValue(leftNumber <= rightNumber);
    case ">":
      return primitiveValue(leftNumber > rightNumber);
    case ">=":
      return primitiveValue(leftNumber >= rightNumber);
    case "&":
      return primitiveValue(leftNumber & rightNumber);
    case "|":
      return primitiveValue(leftNumber | rightNumber);
    case "^":
      return primitiveValue(leftNumber ^ rightNumber);
    case "<<":
      return primitiveValue(leftNumber << rightNumber);
    case ">>":
      return primitiveValue(leftNumber >> rightNumber);
    case ">>>":
      return primitiveValue(leftNumber >>> rightNumber);
    default:
      return undefined;
  }
};
