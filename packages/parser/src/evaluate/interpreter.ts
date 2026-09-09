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
  ObjectExpression,
  ObjectProperty,
  ParamPattern,
  PrivateInExpression,
  PropertyKey,
  SimpleAssignmentTarget,
  Span,
  Statement,
  SwitchStatement,
  TemplateLiteral,
  TryStatement,
  UnaryExpression,
  UnaryOperator,
  UpdateExpression,
  VariableDeclaration,
  VariableDeclarator,
} from "oxc-parser";
import path from "node:path";
import { getAssetModuleValue } from "../graph/asset-module.js";
import { getCssModuleValue } from "../graph/css-module.js";
import { getEsbuildDeclarationName } from "../graph/esbuild-symbol-names.js";
import { isModuleRecord, type ModuleGraph } from "../graph/module-graph.js";
import { hasExportedName } from "../graph/module-record.js";
import { nativeFunction } from "../frameworks/stubs.js";
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
  REACT_ELEMENT_SYMBOL_KEYS,
} from "../react/element-shape.js";
import { toClientReference, toElementKey, toElementType } from "../react/element-type.js";
import {
  getExternalMember,
  isReactLikePackage,
  REACT_MEMO_CACHE_SENTINEL_KEY,
  resolveReactApi,
  resolveReactApiMember,
} from "../react/react-api.js";
import { getCompilerHelper, getInlineCompilerHelper, isEsModuleLike } from "./compiler-helpers.js";
import { createErrorValue } from "./errors.js";
import type {
  ClassBody,
  Diagnostic,
  ExternalValueProvider,
  FunctionLikeNode,
  JournaledState,
  CapturedExportReference,
  CapturedPageState,
  CapturedValue,
  JsonValue,
  ModuleRecord,
  ProjectContext,
  ProcessEnvironment,
  RenderEnvironment,
  ResolvedSymbol,
  Scope,
  SourceLocation,
  StaticClassValue,
  StaticElementType,
  StaticElementValue,
  StaticFunctionValue,
  StaticAccessor,
  StaticListValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticPrimitive,
  StaticValue,
  TopLevelBinding,
  UnknownPrimitiveType,
} from "../types.js";
import {
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
  getFunctionLength,
  getStaticProperty,
  getSuperObject,
  getValueParams,
} from "./class-component.js";
import { getCollectionItems, markCollectionExternallyMutable } from "./collections.js";
import { createGeneratorValue } from "./generators.js";
import { getPageLocationMember } from "./page-location.js";
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
  isBundlerUndeclaredName,
  getInlinedNodeEnv,
  isEnvironmentObject,
  isUnsettableDefineName,
} from "./bundler-globals.js";
import { hasProperty, OBJECT_PROTOTYPE_METHODS } from "./has-property.js";
import { getBuiltinWitness, isInstanceOf } from "./instance-of.js";
import { createIndexedDbFactory, isIndexedDbName } from "./indexed-db.js";
import { getBinaryMember, getBinaryWitness } from "./typed-arrays.js";
import { getWebCryptoMember, isWebCryptoName } from "./web-crypto.js";
import { GLOBAL_OBJECT_VALUE } from "./host-globals.js";
import {
  applyNumberRangeOperator,
  compareNumberRanges,
  concatenateStrings,
  getShapedStringLength,
} from "./primitive-shapes.js";
import {
  getCaughtValue,
  getThrowCertainty,
  getThrownOperand,
  getThrownPaths,
  withoutThrows,
} from "./thrown.js";
import {
  deleteNativeObjectMember,
  getNativeObjectMember,
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
  forEachEscapedCallable,
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
  lookupNarrowingTarget,
  type NarrowingTarget,
  narrowTest,
  narrowTestByEvaluation,
  type TestNarrowing,
  withNarrowedTarget,
} from "./narrowing.js";
import { evaluateReactApiCall } from "./react-calls.js";
import { RootRenderState } from "./root-render.js";
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
  getPropertyName,
  getTruthiness,
  isNullish,
  isSymbolPropertyKey,
  listValue,
  mapValue,
  NULL_VALUE,
  capturedValue,
  isJsonRecord,
  jsonValue,
  objectFromRecord,
  objectValue,
  deleteObjectProperty,
  omitObjectKeys,
  partialJsonValue,
  primitiveValue,
  setListItem,
  setListLength,
  spreadListItems,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  thrownValue,
  unknownValue,
} from "./values.js";
import { createPathPredicate, getTruthinessPredicate, recordNegation } from "./predicates.js";

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

interface JsxAttributeValues {
  props: StaticObjectValue;
  key: StaticValue | null;
}

interface CallValueOptions {
  thisValue?: StaticValue | null;
  nameHint?: string | null;
  templateArgumentNames?: Array<string | null>;
}

type DestructuringPattern = BindingPattern | AssignmentTargetMaybeDefault;

interface PatternLeafAssigner {
  (leaf: BindingIdentifier | SimpleAssignmentTarget, value: StaticValue): void;
}

const UNKNOWN_PROJECT: ProjectContext = {
  rootDirectory: null,
  servedDirectory: null,
  hasDeclaredDependency: () => false,
  readPackageVersion: () => null,
  getImportedAssetUrl: (filePath) => unknownValue(`URL the bundler emits for ${filePath}`),
  transpiler: "name-preserving",
  bundler: "unknown",
  readServedAsset: () => null,
  findQuery: () => null,
  findMutations: () => null,
  linguiCatalog: null,
  routerState: null,
  storeStates: null,
};

/** Vite's `vite:esbuild` default `include` filter; plain `.js` is served untransformed. */
const ESBUILD_TRANSFORMED_FILE = /\.(m?ts|[jt]sx)$/;

const DEFAULT_MAX_CALL_DEPTH = 128;
const DEFAULT_MAX_FORK_DEPTH = 5;
const DEFAULT_MAX_STEPS = 2_000_000;
export const STYLED_JSX_SPECIFIER = "styled-jsx/style";

const MAX_INTERVAL_TICKS = 1_000;
const USE_STRICT_DIRECTIVE = "use strict";
const FS_URL_PREFIX = "/@fs/";
const SERVER_HOST_PLATFORM: HostPlatform = "node";

const PRIMITIVE_PROTOTYPES: Record<UnknownPrimitiveType, object | null> = {
  string: String.prototype,
  number: Number.prototype,
  boolean: Boolean.prototype,
  any: null,
};

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

/** Callees that ignore `this`: one call covers every receiver alternative that resolves to them. */
const isReceiverIndependent = (callee: StaticValue): boolean =>
  callee.kind === "react-api" || callee.kind === "native-function";

/** Names a function has without the analyzed code assigning them; any other name reads `undefined`. */
const isFunctionOwnOrInheritedKey = (key: string): boolean =>
  isSymbolPropertyKey(key) || FUNCTION_INSTANCE_KEYS.has(key) || key in Function.prototype;

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
  prototype === null || key in prototype
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

export interface StatementContinuation {
  (context: EvaluationContext): StatementOutcome;
}

const completeBlock: StatementContinuation = () => COMPLETES;

export const returnOutcome = (value: StaticValue): StatementOutcome => ({
  returned: value,
  mayComplete: false,
  jump: null,
  isSuspended: false,
});

export const outcomeToReturnValue = (
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
 * A recursive call whose arguments are equivalent to those of an activation
 * already on the stack, with nothing written since that activation began,
 * would never bottom out (dynamic values never become more precise). Nor
 * would one that only threads unknowns forward with a changing counter
 * (`walk(node.child, depth + 1)` over an unknown `node`): every level sees
 * the same unknown data, so the result is unknown either way. A call that
 * makes progress over known data (walking a tree, re-entering a batch
 * flush after a counter changed) is followed until the call-depth limit, as
 * is a function re-entered after rewriting its own properties (a proxy that
 * swaps in the real implementation on first call and calls itself again).
 */
const isNonProgressingRecursion = (
  callStack: CallFrame[],
  functionValue: StaticFunctionValue,
  args: StaticValue[],
  changeCount: number,
): boolean => {
  const hasUnknownArgument = args.some(mayBeUnknown);
  return callStack.some(
    (frame) =>
      frame.node === functionValue.node &&
      frame.scope === functionValue.scope &&
      frame.args.length === args.length &&
      (hasUnknownArgument || frame.changeCount === changeCount) &&
      hasSameProperties(frame.properties, functionValue.properties) &&
      frame.args.every(
        (argument, index) =>
          areValuesEquivalent(argument, args[index]) ||
          (hasUnknownArgument &&
            ((mayBeUnknown(argument) && mayBeUnknown(args[index])) ||
              isSameTypePrimitive(argument, args[index]))),
      ),
  );
};

/** An unknown, a member/result of an unanalyzed external, or a branch holding one: further recursion cannot make it more precise. */
const mayBeUnknown = (value: StaticValue): boolean =>
  value.kind === "unknown" ||
  (value.kind === "external" && value.origin === "derived") ||
  (value.kind === "branch" && value.alternatives.some(mayBeUnknown));

const describeEscapedMutation = ({ target, key }: EscapedMutation): string =>
  `"${[...target, ...(key === null ? [] : [key])].join(".")}" is mutated by code the analysis did not run`;

const markExternallyMutable = (value: StaticObjectValue, reason: string): void => {
  if (markCollectionExternallyMutable(value)) return;
  if (value.entries.some((entry) => entry.kind === "spread" && entry.value.kind === "unknown")) {
    return;
  }
  value.entries.push({ kind: "spread", value: unknownValue(reason) });
};

/**
 * A mutation of a statically known property widens that property alone and a
 * computed member the whole object. A mutating method call only widens a
 * collection: a plain object defines such a method itself, so the method body
 * is the mutation. Each is idempotent, so following a closure again leaves the
 * object as it was.
 */
const markEscapedMutation = (value: StaticValue, mutation: EscapedMutation): void => {
  if (value.kind !== "object") return;
  if (mutation.isMethodCall) {
    markCollectionExternallyMutable(value);
    return;
  }
  const reason = describeEscapedMutation(mutation);
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

export interface CallOptions {
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
  private readonly project: ProjectContext;
  readonly origin: string | null;
  readonly history: SessionHistory;
  private readonly purePackages: PurePackages | null;
  private readonly windowGlobals = new Map<string, StaticValue>();
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
  /** Observable changes (state commits, heap mutations) so far; a timer tick that adds none is steady state. */
  changeCount = 0;
  private readonly heapJournals: HeapJournal[] = [];
  /** The outcomes of the `await`s a statement is being (re-)evaluated with, each consumed by its `await`. */
  private resolvedAwaits = new Map<AwaitExpression, StaticValue>();
  private readonly generatorYields: StaticValue[][] = [];
  private readonly elementSymbolKey: string;
  private readonly reactVersion: string | null;
  readonly doesStrictModeDoubleInvokeHookFactories: boolean;
  private readonly maxSteps: number;
  private readonly moduleScopes = new Map<string, Scope>();
  private readonly moduleValues = new Map<string, ModuleValues>();
  private readonly initializedModules = new Set<string>();
  /** Module bindings mutated by closures that escaped before the binding was evaluated. */
  /** Module variables mutated by escaped closures before the variable was evaluated, by file, name and property key. */
  private readonly escapedMutations = new Map<string, Map<string, Set<EscapedMutation>>>();
  private readonly exportExpressionValues = new WeakMap<
    Expression,
    StaticValue | typeof IN_PROGRESS
  >();
  /** One evaluation per destructuring declarator, shared by every name it binds. */
  private readonly destructuredInitValues = new WeakMap<Expression, StaticValue>();
  private readonly diagnosticKeys = new Set<string>();

  constructor(graph: ModuleGraph, options: InterpreterOptions = {}) {
    this.graph = graph;
    this.timers = new TimerQueue(options.settleMs, options.timerUnderrunMs);
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
    this.maxForkDepth = options.maxForkDepth ?? DEFAULT_MAX_FORK_DEPTH;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.externalValues = options.externalValues ?? null;
    this.project = options.project ?? UNKNOWN_PROJECT;
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
    this.reactVersion = options.reactVersion ?? null;
    this.elementSymbolKey = getReactElementSymbolKey(this.reactVersion);
    this.doesStrictModeDoubleInvokeHookFactories = doesStrictModeDoubleInvokeHookFactories(
      this.reactVersion,
    );
    this.assumeOuterProviders = options.assumeOuterProviders ?? false;
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
      scope: this.getModuleScope(module),
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

  getModuleScope(module: ModuleRecord): Scope {
    let scope = this.moduleScopes.get(module.filePath);
    if (!scope) {
      scope = createScope(null);
      this.moduleScopes.set(module.filePath, scope);
    }
    return scope;
  }

  evaluateModuleExport(module: ModuleRecord, exportedName: string): StaticValue {
    return this.resolvedSymbolToValue(this.graph.resolveExport(module, exportedName), exportedName);
  }

  /** Bundler interop: a default import is `module.exports` itself unless it is flagged `__esModule`. */
  private evaluateModuleExportsMember(module: ModuleRecord, exportedName: string): StaticValue {
    const moduleExports = this.evaluateModuleExports(module);
    if (exportedName === "default" && !isEsModuleLike(moduleExports)) return moduleExports;
    return this.getProperty(moduleExports, exportedName, this.createModuleContext(module), null);
  }

  private evaluateModuleExports(module: ModuleRecord): StaticValue {
    if (!module.moduleExports) return { kind: "namespace", module };
    return this.resolvedSymbolToValue(
      {
        kind: "expression",
        module,
        exportedName: "default",
        expression: module.moduleExports,
        isClientReference: false,
      },
      "default",
    );
  }

  /**
   * A name a namespace lacks is `undefined` when its export list is complete:
   * an ESM module whose `export *` sources are all analyzed, or a CommonJS
   * module that replaces `module.exports`, whose own `exports` object only
   * holds the statically collected members.
   */
  private getNamespaceMember(module: ModuleRecord, key: string): StaticValue {
    if (hasExportedName(module, key)) return this.evaluateModuleExport(module, key);
    if (key === "__esModule") return module.isCommonJs ? UNDEFINED_VALUE : TRUE_VALUE;
    if (module.isCommonJs && module.moduleExports === null) {
      return this.evaluateModuleExport(module, key);
    }
    const { names, complete } = this.graph.collectExportNames(module);
    return complete && !names.includes(key)
      ? UNDEFINED_VALUE
      : this.evaluateModuleExport(module, key);
  }

  /** The exports of a module as an object, for `{ ...m }` / `const { a, ...rest } = m` over a namespace. */
  materializeNamespace(module: ModuleRecord): StaticValue {
    const { names, complete } = this.graph.collectExportNames(module);
    if (!complete) {
      return unknownValue(`namespace of ${module.filePath} re-exports an unanalyzed module`);
    }
    return objectValue(
      names.map((name) => ({
        kind: "property",
        key: name,
        value: this.evaluateModuleExport(module, name),
      })),
    );
  }

  private getModuleValues(module: ModuleRecord): ModuleValues {
    let values = this.moduleValues.get(module.filePath);
    if (!values) {
      values = new Map();
      this.moduleValues.set(module.filePath, values);
    }
    return values;
  }

  evaluateModuleBinding(module: ModuleRecord, name: string): StaticValue | null {
    const binding = module.bindings.get(name);
    if (!binding) return null;
    this.initializeModule(module);
    return this.evaluateDeclaredBinding(module, binding);
  }

  /**
   * A module binding as escape analysis may see it without running the module:
   * whatever is already evaluated, plus hoisted function and class declarations,
   * whose creation has no side effects.
   */
  private peekModuleBinding(module: ModuleRecord, name: string): StaticValue | null {
    const binding = module.bindings.get(name);
    if (!binding) return null;
    const cached = this.getModuleValues(module).get(name);
    if (cached) return cached === IN_PROGRESS ? null : cached;
    return binding.kind === "function" || binding.kind === "class"
      ? this.evaluateDeclaredBinding(module, binding)
      : null;
  }

  private evaluateDeclaredBinding(module: ModuleRecord, binding: TopLevelBinding): StaticValue {
    const { name } = binding;
    const values = this.getModuleValues(module);
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
    const value = this.evaluateTopLevelBindingValue(
      module,
      binding,
      this.createModuleContext(module),
    );
    values.set(name, value);
    this.escapeWalk.memo.invalidate(module, name);
    this.journalLazyBindingValue(value);
    for (const mutation of this.escapedMutations.get(module.filePath)?.get(name) ?? []) {
      markEscapedMutation(value, mutation);
    }
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
  ): void {
    if (this.initializedModules.has(module.filePath)) return;
    this.initializedModules.add(module.filePath);
    this.initializeDependencies(module);
    const context = this.createModuleContext(module);
    let pendingStatements: Statement[] = [];
    const flushPendingStatements = (): void => {
      if (pendingStatements.length === 0) return;
      this.evaluateBlock(pendingStatements, context, false);
      pendingStatements = [];
    };
    for (const statement of sideEffectStatements) {
      const declaration = getVariableDeclaration(statement);
      if (!declaration) {
        pendingStatements.push(statement);
        continue;
      }
      flushPendingStatements();
      for (const name of getDeclaredNames(declaration)) this.evaluateModuleBinding(module, name);
    }
    flushPendingStatements();
    for (const name of module.outParameterBindings) this.evaluateModuleBinding(module, name);
  }

  private initializeDependencies(module: ModuleRecord): void {
    for (const specifier of module.dependencies) {
      const target = this.graph.resolveImportedModule(specifier, module);
      if (isModuleRecord(target)) this.initializeModule(target);
    }
  }

  resolvedSymbolToValue(symbol: ResolvedSymbol, nameHint: string | null): StaticValue {
    switch (symbol.kind) {
      case "binding": {
        const value =
          this.evaluateModuleBinding(symbol.module, symbol.binding.name) ?? UNDEFINED_VALUE;
        return symbol.isClientReference ? toClientReference(value) : value;
      }
      case "expression": {
        const value = this.evaluateExportExpression(
          symbol.module,
          symbol.expression,
          symbol.module.isCommonJs ? nameHint : "default",
        );
        return symbol.isClientReference ? toClientReference(value) : value;
      }
      case "namespace":
        return { kind: "namespace", module: symbol.module };
      case "module-exports": {
        const value = this.evaluateModuleExportsMember(symbol.module, symbol.exportedName);
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
          if (api) return { kind: "react-api", api };
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
          importedName,
          origin: "binding",
        };
      }
      case "stylesheet":
        return getCssModuleValue(symbol.filePath, symbol.imported);
      case "asset":
        return getAssetModuleValue(symbol.filePath, symbol.imported, this.project);
      case "unresolved":
        return unknownValue(symbol.reason);
    }
  }

  private getModeledExternal(
    specifier: string,
    importedName: string,
    filePath: string | null = null,
  ): StaticValue | null {
    return (
      this.externalValues?.(specifier, importedName) ??
      getLibraryValue(specifier, importedName, this.project) ??
      this.purePackages?.getExport(specifier, importedName, filePath) ??
      null
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
  ): StaticValue {
    const nameHint = isAnonymousFunctionOrClass(expression) ? exportedName : null;
    const cached = this.exportExpressionValues.get(expression);
    if (cached === IN_PROGRESS) {
      return unknownValue(
        "cyclic module-level evaluation of an export",
        this.locate(module, expression),
      );
    }
    if (cached) return cached;
    this.exportExpressionValues.set(expression, IN_PROGRESS);
    const value = this.evaluateExpression(expression, this.createModuleContext(module), nameHint);
    this.exportExpressionValues.set(expression, value);
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
            this.callValue(accessor.set, [value], context, null, { thisValue: target });
          }
          return target;
        }
        this.assignOwnProperty(target, propertyName, value);
        return target;
      }
      case "list": {
        if (target.isFrozen) return target;
        const index = Number(propertyName);
        if (Number.isInteger(index) && index >= 0) {
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
        this.changeCount++;
        if (target.kind === "function") this.escapeWalk.memo.invalidate(target, propertyName);
        target.properties.set(propertyName, value);
        return target;
      case "global":
        if (this.getRealm(context.environment).isGlobalAlias(target.name)) {
          this.windowGlobals.set(
            propertyName,
            this.withUncertainAssignment(
              this.windowGlobals.get(propertyName),
              value,
              `window.${propertyName}`,
              context,
            ),
          );
        }
        return target;
      case "regexp":
        if (propertyName === "lastIndex") {
          target.lastIndex =
            value.kind === "primitive" && typeof value.value === "number" ? value.value : 0;
        }
        return target;
      case "native-object":
        setNativeObjectMember(target, propertyName, value);
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
          this.changeCount++;
          type.component.properties.set(propertyName, value);
          return target;
        }
        const displayName =
          value.kind === "primitive" && typeof value.value === "string" ? value.value : null;
        if (type.kind === "stub") {
          if (propertyName === "displayName") {
            type.stub.displayName = displayName;
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
        this.changeCount++;
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
        const replacement = this.evaluateModuleExport(target.module, "default");
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
        return (
          (isFunctionLikeExpression(binding.init)
            ? getInlineCompilerHelper(binding.name, binding.init)
            : null) ?? this.evaluateExpression(binding.init, context, binding.name)
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
    const cached = this.destructuredInitValues.get(init);
    if (cached) return cached;
    const value = this.evaluateExpression(init, context, null);
    this.destructuredInitValues.set(init, value);
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
    return this.defineClass(
      node,
      { members: collectClassMembers(node), superValue },
      context,
      this.getDeclaredName(node, context.module) ?? nameHint,
    );
  }

  /** Materializes a class from its members, evaluating static members with `this` bound to the class. */
  defineClass(
    node: Class | FunctionLikeNode,
    body: ClassBody,
    context: EvaluationContext,
    name: string | null,
  ): StaticClassValue {
    const classValue: StaticClassValue = {
      kind: "class",
      node,
      body,
      scope: context.scope,
      module: context.module,
      name,
      properties: new Map(),
    };
    const staticContext: EvaluationContext = { ...context, thisValue: classValue };
    for (const member of body.members) {
      if (!member.isStatic) continue;
      if (member.kind === "field") {
        classValue.properties.set(
          member.key,
          member.value
            ? this.evaluateExpression(member.value, staticContext, member.key)
            : UNDEFINED_VALUE,
        );
        continue;
      }
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
      classValue.properties.set(
        member.key,
        member.kind === "getter"
          ? this.callFunction(bound, [], staticContext, { thisValue: classValue })
          : bound,
      );
    }
    return classValue;
  }

  lookupIdentifier(name: string, context: EvaluationContext): StaticValue {
    const resolved = this.resolveIdentifier(name, context);
    if (resolved) return resolved;
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
    const moduleValue = this.evaluateModuleBinding(context.module, name);
    if (moduleValue) return moduleValue;
    if (context.module.isCommonJs) {
      const exportsValue: StaticValue = { kind: "namespace", module: context.module };
      if (name === "exports") return exportsValue;
      if (name === "module") return objectFromRecord({ exports: exportsValue });
    }
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

  private getGlobal(name: string, renderEnvironment: RenderEnvironment | null): StaticValue | null {
    const defined = this.defines.get(name);
    if (defined) return defined;
    if (renderEnvironment !== "server" && isBundlerUndeclaredName(this.project.bundler, name)) {
      return null;
    }
    const realm = this.getRealm(renderEnvironment);
    const hostName = realm.normalizeGlobalName(name);
    const observed = realm.hasDocument ? this.getObservedPageMember(hostName) : null;
    if (observed) return observed;
    if (renderEnvironment !== "server") {
      if (hostName === "global" && this.project.hasDeclaredDependency("webpack"))
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
    return (
      pageLocationMember ??
      getBuiltinGlobal(hostName, realm, renderEnvironment === "server" ? null : this.hostDocument, {
        declared: this.processEnvironment,
        renderEnvironment,
        definedObjects: this.definedEnvironmentObjects,
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
        const tag = this.evaluateExpression(node.tag, context);
        if (tag.kind === "external") {
          return { ...tag, importedName: `${tag.importedName}\`\``, origin: "derived" };
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
          yields.push(...spreadListItems(getCollectionItems(argument) ?? argument, location));
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
        const spread = this.evaluateExpression(element.argument, context);
        items.push(
          ...spreadListItems(
            getCollectionItems(spread) ?? spread,
            this.locate(context.module, element),
          ),
        );
        continue;
      }
      items.push(this.evaluateExpression(element, context));
    }
    return listValue(items);
  }

  /** Mutating a value that predates an enclosing fork must be undone for the fork's other paths. */
  recordHeapMutation(target: MutableHeapValue): void {
    this.changeCount++;
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
    this.changeCount++;
    for (let index = this.heapJournals.length - 1; index >= 0; index--) {
      const journal = this.heapJournals[index];
      if (!journal.isPreexisting(state)) return;
      journal.recordState(state);
    }
  }

  /** A state update queued on one path of an enclosing fork is pending on that path only. */
  recordStateUpdate(cell: StateCell): void {
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
    return getPropertyName(this.evaluateExpression(key, context));
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
          value: spread.kind === "namespace" ? this.materializeNamespace(spread.module) : spread,
        });
        continue;
      }
      const key = this.evaluatePropertyKey(property.key, property.computed, context);
      if (key === null) {
        entries.push({ kind: "spread", value: unknownValue("computed property key") });
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
            narrowed ? this.evaluateExpression(node.left, context) : falsyCounterpart(left),
          reason,
          location,
          preferredSide,
          predicate,
        );
        if (!right) return falsyLeft ?? falsyCounterpart(left);
        if (!falsyLeft) return right;
        return branchValue([right, falsyLeft], reason, location, preferredSide, predicate);
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
            narrowed ? this.evaluateExpression(node.left, context) : truthyCounterpart(left),
          () => this.evaluateExpression(node.right, context),
          reason,
          location,
          preferredSide,
          predicate,
        );
        if (!truthyLeft) return right ?? left;
        if (!right) return truthyLeft;
        return branchValue([truthyLeft, right], reason, location, preferredSide, predicate);
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
            : branchValue([alternative, right], `?? on ${describeValue(alternative)}`, location);
        };
        return mapValue(left, withRight);
      }
    }
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
    predicate: string,
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
    const name = getPropertyName(key);
    switch (target.kind) {
      case "native-object":
        if (name !== null) deleteNativeObjectMember(target, name);
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
        hasProperty(left, right) ??
        this.hasGlobalObjectProperty(left, right, context.environment) ??
        applyBinaryOperator("in", left, right)
      );
    }
    return applyBinaryOperator(node.operator, left, right, this.getRealm(context.environment));
  }

  /**
   * `name in window`: a name the page assigned, one the captured browser exposed, or,
   * without a capture, one the host declares outright (optional members stay open).
   */
  private hasGlobalObjectProperty(
    key: StaticValue,
    target: StaticValue,
    environment: RenderEnvironment | null,
  ): StaticValue | null {
    const realm = this.getRealm(environment);
    if (target.kind !== "global" || !realm.isGlobalAlias(target.name)) return null;
    const name = getPropertyName(key);
    if (name === null) return null;
    if (environment !== "server") {
      if (this.windowGlobals.has(name)) return TRUE_VALUE;
      const windowKeys = this.pageState?.windowKeys;
      if (windowKeys) return primitiveValue(windowKeys.includes(name));
    }
    const declared = realm.getGlobal(name);
    if (declared !== null) return declared.type.isNullable ? null : TRUE_VALUE;
    return realm.isForeignGlobal(name) ? FALSE_VALUE : null;
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
      this.assignTarget(target, value, context);
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
          ? branchValue([current, right], `${node.operator} on ${describeValue(current)}`)
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
      case "MemberExpression":
        if (!target.computed && target.property.type === "Identifier") {
          this.assignMember(target.object, target.property.name, value, context);
        } else if (target.computed) {
          const key = this.evaluateExpression(target.property, context);
          const propertyName = getPropertyName(key);
          if (propertyName !== null) {
            this.assignMember(target.object, propertyName, value, context);
          } else {
            this.assignDynamicMember(target.object, key, value, context);
          }
        }
        return;
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
    } else if (
      objectNode.type === "MemberExpression" &&
      !objectNode.computed &&
      objectNode.property.type === "Identifier"
    ) {
      this.assignMember(objectNode.object, objectNode.property.name, reassigned, context);
    }
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
      else if (alternative.kind === "unknown" || alternative.kind === "external")
        this.markEscaped(value);
    }
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
      this.changeCount++;
      this.escapeWalk.memo.invalidate(owner, name);
      owner.bindings.set(
        name,
        this.withUncertainAssignment(owner.bindings.get(name), value, name, context),
      );
      return;
    }
    if (context.module.bindings.get(name)?.kind !== "variable") return;
    const values = this.getModuleValues(context.module);
    if (!values.has(name)) this.evaluateModuleBinding(context.module, name);
    const previous = values.get(name);
    if (previous === undefined || previous === IN_PROGRESS) return;
    this.changeCount++;
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
    const propertyName = getPropertyName(key);
    if (propertyName !== null) {
      return this.getProperty(object, propertyName, context, location, node.optional);
    }
    if (object === CHAIN_SHORT_CIRCUIT) return object;
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
        const property = type.component.properties.get(key);
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
        if (key === "displayName" || key === "name")
          return type.stub.displayName === null
            ? UNDEFINED_VALUE
            : primitiveValue(type.stub.displayName);
        return getStubOwnKeys(type.stub.tag).has(key)
          ? unknownValue(`${type.stub.displayName ?? "stub"}.${key}`, location)
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
            ? this.callValue(accessor.get, [], context, location, { thisValue: object })
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
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0) {
          return getListItem(object.items, index, location);
        }
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
        if (typeof object.value === "string" && key === "length")
          return primitiveValue(object.value.length);
        return prototypeMember(object, Object.getPrototypeOf(object.value), key);
      case "unknown-primitive":
        if (key === "length") {
          return object.primitiveType === "string"
            ? getShapedStringLength(object)
            : unknownPrimitiveValue("number", "length of dynamic value");
        }
        return prototypeMember(object, PRIMITIVE_PROTOTYPES[object.primitiveType], key);
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
        if (isCallableProtocolKey(key)) return { kind: "method", receiver: object, name: key };
        const member = resolveReactApiMember(object.api, key);
        if (member) return member;
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
              specifier: object.packageName,
              filePath: null,
            },
            null,
          );
        }
        if (object.origin !== "binding" && isModeledOpaqueMethodName(key))
          return { kind: "method", receiver: object, name: key };
        if (object.importedName === "default" && object.origin === "binding") {
          const modeled = this.getModeledExternal(object.packageName, key);
          if (modeled) return modeled;
        }
        if (object.importedName === "*" || object.importedName === "default") {
          const version = this.getReactVersionExport(object.packageName, key);
          if (version) return version;
        }
        return getExternalMember(object, key);
      case "native-object":
        return getNativeObjectMember(object, key);
      case "namespace":
        return this.getNamespaceMember(object.module, key);
      case "global": {
        const storageAreaName = getStorageAreaName(object.name);
        if (storageAreaName !== null) {
          return key === "length"
            ? getStorageLength(this.storageAreas[storageAreaName], storageAreaName)
            : { kind: "method", receiver: object, name: key };
        }
        if (isHistoryName(object.name)) {
          return (
            getHistoryMember(this.history, key) ?? { kind: "method", receiver: object, name: key }
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
        const declaredMember = this.getGlobal(memberName, context.environment);
        if (declaredMember) return declaredMember;
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
        if (object.kind === "function" && !isFunctionOwnOrInheritedKey(key)) return UNDEFINED_VALUE;
        return unknownValue(`${describeValue(object)}.${key}`, location);
      }
      case "component-reference":
        return this.readComponentProperty(object, object.type, key, location);
      case "repeat":
        if (key === "length") return unknownPrimitiveValue("number", "length of a repeated list");
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
        if (object === CHAIN_SHORT_CIRCUIT) return object;
        return object.thrown ? object : unknownValue(object.reason, location);
    }
  }

  evaluateArguments(args: Argument[], context: EvaluationContext): StaticValue[] {
    const values: StaticValue[] = [];
    for (const argument of args) {
      if (argument.type === "SpreadElement") {
        const evaluated = this.evaluateExpression(argument.argument, context);
        const spread = getCollectionItems(evaluated) ?? evaluated;
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
      return isRequire ? this.evaluateModuleExports(target) : { kind: "namespace", module: target };
    }
    if (target.kind === "external" || target.kind === "builtin") {
      const packageName = target.kind === "external" ? target.packageName : target.specifier;
      const filePath = target.kind === "external" ? target.filePath : null;
      if (isRequire) {
        const required = this.purePackages?.getRequired(specifier, filePath);
        if (required) return required;
      }
      return this.resolvedSymbolToValue(
        { kind: "external", packageName, imported: { kind: "namespace" }, specifier, filePath },
        null,
      );
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
    const callWith = (callee: StaticValue, thisValue: StaticValue | null): StaticValue => {
      if (callee === CHAIN_SHORT_CIRCUIT) return callee;
      if (node.optional && isNullish(callee) === true) return CHAIN_SHORT_CIRCUIT;
      args ??= this.evaluateArguments(node.arguments, context);
      return this.callValue(callee, args, context, location, { thisValue, nameHint });
    };
    if (node.callee.type !== "MemberExpression") {
      return callWith(this.evaluateExpression(node.callee, context), null);
    }
    const member = node.callee;
    const receiver = this.evaluateExpression(member.object, context);
    const key =
      member.property.type === "PrivateIdentifier"
        ? primitiveValue(`#${member.property.name}`)
        : member.computed
          ? this.evaluateExpression(member.property, context)
          : primitiveValue(member.property.name);
    const getCallee = (target: StaticValue): StaticValue => {
      if (target === CHAIN_SHORT_CIRCUIT) return target;
      if (member.optional && isNullish(target) === true) return CHAIN_SHORT_CIRCUIT;
      return key.kind === "primitive"
        ? this.getProperty(target, String(key.value), context, location, member.optional)
        : unknownValue("computed method call", location);
    };
    const receivers = receiver.kind === "branch" ? receiver.alternatives : [receiver];
    const callees = receivers.map(getCallee);
    const joinAlternatives = (values: StaticValue[]): StaticValue =>
      receiver.kind === "branch"
        ? branchValue(values, receiver.reason, receiver.location, receiver.preferredIndex)
        : values[0];
    const callee = joinAlternatives(callees);
    if (isReceiverIndependent(callee)) return callWith(callee, null);
    return joinAlternatives(
      receivers.map((target, index) =>
        callWith(callees[index], member.object.type === "Super" ? context.thisValue : target),
      ),
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
        return mapValue(callee, (alternative) =>
          this.callValue(alternative, args, context, location, options),
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
          return mapValue(callee.receiver, (receiver) =>
            this.callValue({ ...callee, receiver }, args, context, location, options),
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
          importedName: `${callee.importedName}()`,
          origin: "derived",
        };
      case "native-function":
        return callee.call(args, {
          readContext: (definition) => context.readContext(definition) ?? definition.defaultValue,
          hooks: null,
          callAwaited: (callee, calleeArgs) =>
            this.callAwaited(callee, calleeArgs, context, location),
          call: (callee, calleeArgs) => this.callValue(callee, calleeArgs, context, location),
          callDeferred: (callee, calleeArgs) =>
            this.callDeferred(callee, calleeArgs, context, location),
          captured: (captured, name) => this.captured(captured, name),
          markEscaped: (value) => this.markEscaped(value),
          queueMicrotask: (task) => this.timers.queueMicrotask(task),
          isDeferred: () => this.timers.isDeferred || (context.hooks?.isDeferred ?? false),
          setProperty: (object, key, value) => this.assignOwnProperty(object, key, value),
          recordStateMutation: (state) => this.recordStateMutation(state),
          realm: this.getRealm(context.environment),
          pushItems: (list, items) => this.pushItems(list, items),
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
    memo: new EscapeMemo(),
  };

  /**
   * Escaped code widens the heap it names through the variables it captures
   * and its module's bindings. Its arguments and `this` belong to whichever
   * escaped code handed them over; only a closure that escaped directly, as a
   * callback or bound method, may widen the `this` it was bound to.
   */
  private markEscapedMutations(
    functionValue: StaticFunctionValue,
    frame: EscapeFrame | null,
  ): void {
    const { module } = functionValue;
    for (const mutation of getEscapedMutations(functionValue.node)) {
      const [root] = mutation.target;
      if (isClosureLocal(functionValue, root) || (root === "this" && frame !== null)) continue;
      const resolved = resolveAccessPath(functionValue, null, mutation.target, this.escapeWalk);
      if (resolved.length > 0) {
        for (const value of resolved) markEscapedMutation(value, mutation);
        continue;
      }
      if (mutation.target.length !== 1 || module.bindings.get(root)?.kind !== "variable") continue;
      let mutationsByName = this.escapedMutations.get(module.filePath);
      if (!mutationsByName) {
        mutationsByName = new Map();
        this.escapedMutations.set(module.filePath, mutationsByName);
      }
      let mutations = mutationsByName.get(root);
      if (!mutations) {
        mutations = new Set();
        mutationsByName.set(root, mutations);
      }
      mutations.add(mutation);
    }
  }

  private evaluateNewExpression(node: NewExpression, context: EvaluationContext): StaticValue {
    const callee = this.evaluateExpression(node.callee, context);
    const location = this.locate(context.module, node);
    const args = this.evaluateArguments(node.arguments, context);
    return this.construct(callee, args, context, location);
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
    const returned = this.callFunction(callee, args, context, { thisValue: instance });
    if (returned.kind === "unknown") {
      return returned.thrown
        ? returned
        : unknownValue(
            `new ${describeValue(callee)} whose constructor ${returned.reason}`,
            location,
          );
    }
    return returned.kind === "object" || returned.kind === "function" || returned.kind === "list"
      ? returned
      : instance;
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
        const changesBefore = this.changeCount;
        if (isDeferred) this.callDeferred(callback, [], context, location);
        else this.callValue(callback, [], context, location);
        if (this.timers.isCleared(handle) || this.changeCount === changesBefore) return;
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
    if (isNonProgressingRecursion(callStack, functionValue, args, this.changeCount)) {
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
    const callContext: EvaluationContext = {
      module: functionValue.module,
      scope,
      budget: context.budget,
      thisValue:
        functionValue.node.type === "ArrowFunctionExpression"
          ? functionValue.thisValue
          : (options.thisValue ?? null),
      superBinding: functionValue.superBinding,
      readContext: context.readContext,
      callStack: [
        ...callStack,
        {
          node: functionValue.node,
          scope: functionValue.scope,
          args,
          changeCount: this.changeCount,
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
    const outcome = this.evaluateBlock(body.body, callContext, false);
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
    const superValue = this.evaluateArguments(call.arguments, context)[0] ?? UNDEFINED_VALUE;
    const scope = createScope(context.scope);
    const wrapperContext: EvaluationContext = { ...context, scope };
    this.bindParameters(compiled.wrapper.params, [superValue], scope, wrapperContext);
    const classValue = this.defineClass(
      compiled.wrapper,
      { members: compiled.members, superValue },
      wrapperContext,
      compiled.name,
    );
    declareInScope(scope, compiled.name, classValue);
    this.evaluateBlock(compiled.setup, wrapperContext, false);
    return classValue;
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
    const nameHint = declarator.id.type === "Identifier" ? declarator.id.name : null;
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
              value.kind === "namespace" ? this.materializeNamespace(value.module) : value;
            const rest =
              source.kind === "object"
                ? omitObjectKeys(source, usedKeys)
                : unknownValue(`rest of ${describeValue(source)}`);
            destructure(property.argument, rest);
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
        pattern.elements.forEach((element, index) => {
          if (!element) return;
          if (element.type === "RestElement") {
            const rest =
              value.kind === "list" &&
              value.items.slice(0, index).every((item) => item.kind !== "repeat")
                ? listValue(value.items.slice(index))
                : unknownValue(`rest of ${describeValue(value)}`);
            destructure(element.argument, rest);
            return;
          }
          destructure(element, this.getProperty(value, String(index), context, null, true));
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
          const narrowed =
            (value: StaticValue | null, run: StatementContinuation): StatementContinuation =>
            (pathContext) => {
              if (narrowing && value) {
                applyNarrowing(context.scope, narrowing.target, value, (object) =>
                  this.journalHeapValue(object),
                );
              }
              return run(pathContext);
            };
          return this.forkPaths(
            [
              narrowed(narrowing?.whenTrue ?? null, (pathContext) =>
                this.evaluateBlock([statement.consequent], pathContext, true),
              ),
              narrowed(narrowing?.whenFalse ?? null, (pathContext) =>
                alternate ? this.evaluateBlock([alternate], pathContext, true) : COMPLETES,
              ),
            ],
            context,
            proceed,
            `if (${describeValue(test)})`,
            location,
            getPreferredTruthiness(test) === false ? 1 : 0,
            getTruthinessPredicate(test),
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
   * the changed one preferred unless `isLikelyRun` is false.
   */
  runMaybe<Result>(
    scope: Scope,
    run: () => Result,
    reason: string,
    location: SourceLocation | null,
    isLikelyRun = true,
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
      this.heapJournals.pop();
      const preferredPath = isLikelyRun ? 0 : 1;
      const predicate = createPathPredicate();
      journal.join(reason, location, preferredPath, predicate);
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
    this.heapJournals.push(journal);
    try {
      run();
    } finally {
      const ranSnapshot = snapshotScopes(scope);
      journal.endPath();
      this.heapJournals.pop();
      restoreScopes(entrySnapshot);
      widenMovedBindings(entrySnapshot, ranSnapshot, location);
    }
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
    predicate = createPathPredicate(),
  ): StatementOutcome {
    const isTooDeep = context.forkDepth >= this.maxForkDepth;
    const forkContext: EvaluationContext = {
      ...context,
      forkDepth: context.forkDepth + 1,
      uncertainDepth: context.uncertainDepth + (isTooDeep ? 1 : 0),
      suspension: null,
    };
    const entrySnapshot = snapshotScopes(context.scope);
    const hookCursor = context.hooks?.cursor ?? 0;
    const joinedSnapshots: ScopeSnapshot[][] = [];
    let completedHookCursor = hookCursor;
    const journal = new HeapJournal();
    this.heapJournals.push(journal);
    const outcomes = branches.map((branch, branchIndex) => {
      if (branchIndex > 0) {
        restoreScopes(entrySnapshot);
        if (context.hooks) context.hooks.cursor = hookCursor;
      }
      const outcome = branch(forkContext);
      if (outcome.mayComplete || outcome.jump !== null) {
        joinedSnapshots.push(snapshotScopes(context.scope));
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
    const isMixed = completingPaths.length > 0 && jumpingPaths.length > 0;
    if (isMixed) {
      const preferredCompleting = Math.max(completingPaths.indexOf(preferredOutcome), 0);
      journal.continueFrom(completingPaths, reason, location, preferredCompleting, null);
    } else {
      this.heapJournals.pop();
      journal.join(reason, location, preferredOutcome, predicate);
    }
    if (joinedSnapshots.length > 0) {
      joinScopes(
        joinedSnapshots,
        reason,
        location,
        0,
        joinedSnapshots.length === branches.length ? predicate : null,
      );
    }
    if (completingPaths.length === 0) {
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
    if (isMixed) {
      this.heapJournals.pop();
      journal.endPath();
      const preferredJumping = jumpingPaths.indexOf(preferredOutcome);
      journal.join(
        reason,
        location,
        preferredJumping === -1 ? jumpingPaths.length : preferredJumping,
        null,
      );
    }
    const isRestPositional =
      outcomes.slice(0, -1).every(isPureReturn) && isPureCompletion(outcomes[outcomes.length - 1]);
    return mergeOutcomes(
      [...outcomes.map((outcome) => ({ ...outcome, mayComplete: false })), rest],
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
    let matchIndex = -1;
    let isDecided = true;
    for (const [caseIndex, caseValue] of caseValues.entries()) {
      if (caseValue === null) continue;
      const verdict = getTruthiness(
        applyBinaryOperator("===", discriminant, caseValue, this.getRealm(context.environment)),
      );
      if (verdict === true) {
        matchIndex = caseIndex;
        break;
      }
      if (verdict === null) {
        isDecided = false;
        break;
      }
    }
    if (isDecided) {
      if (matchIndex === -1)
        matchIndex = statement.cases.findIndex((switchCase) => switchCase.test === null);
      return matchIndex === -1 ? proceed(context) : runThenProceed(matchIndex);
    }
    const hasDefault = statement.cases.some((switchCase) => switchCase.test === null);
    const branches: StatementContinuation[] = statement.cases.map(
      (_, caseIndex) => (pathContext) => runFrom(caseIndex, pathContext),
    );
    if (!hasDefault) branches.push(() => COMPLETES);
    return this.forkPaths(
      branches,
      context,
      proceed,
      `switch (${describeValue(discriminant)})`,
      location,
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
    let key: StaticValue | null = null;
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
      if (name === "key") {
        key = value;
        continue;
      }
      entries.push({ kind: "property", key: name, value });
    }
    return { props: objectValue(entries), key };
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
      props.entries.push({ kind: "property", key: "children", value: children[0] });
    } else if (children.length > 1) {
      props.entries.push({ kind: "property", key: "children", value: listValue(children) });
    }
    const elementKey = toElementKey(key);
    const element = (elementType: StaticValue): StaticElementValue => ({
      kind: "element",
      type: toElementType(elementType, nameHint),
      key: elementKey,
      props,
      location,
      environment: context.environment,
    });
    if (type.kind === "branch") {
      return branchValue(
        type.alternatives.map(element),
        type.reason,
        type.location,
        type.preferredIndex,
      );
    }
    return element(type);
  }

  private evaluateJsxElement(node: JSXElement, context: EvaluationContext): StaticValue {
    const { props, key } = this.evaluateJsxAttributes(node.openingElement.attributes, context);
    const type =
      this.getStyledJsxType(node.openingElement.name, props) ??
      this.evaluateJsxName(node.openingElement.name, context);
    const children = this.evaluateJsxChildren(node.children, context);
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
    return this.createElement(
      { kind: "react-api", api: "Fragment" },
      objectValue(),
      null,
      children,
      this.locate(context.module, node),
      "Fragment",
      context,
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

const restoreScopes = (snapshots: ScopeSnapshot[]): void => {
  for (const snapshot of snapshots) {
    snapshot.scope.bindings.clear();
    for (const [name, value] of snapshot.bindings) snapshot.scope.bindings.set(name, value);
  }
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
        branchValue(values, reason, location, preferredPath, predicate),
      );
    }
  });
};

const WRAPPER_SYMBOL_KEYS = {
  memo: "react.memo",
  "forward-ref": "react.forward_ref",
  lazy: "react.lazy",
} as const;

const MAX_DISTRIBUTED_ALTERNATIVES = 16;

const countAlternatives = (value: StaticValue): number =>
  value.kind === "branch" ? value.alternatives.length : 1;

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
  if (countAlternatives(left) * countAlternatives(right) <= MAX_DISTRIBUTED_ALTERNATIVES) {
    if (left.kind === "branch") {
      return mapValue(left, (alternative) =>
        applyBinaryOperator(operator, alternative, right, realm),
      );
    }
    if (right.kind === "branch") {
      return mapValue(right, (alternative) =>
        applyBinaryOperator(operator, left, alternative, realm),
      );
    }
  }
  const thrownOperand = getThrownOperand([left, right]);
  if (thrownOperand) return thrownOperand;
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
    case "instanceof":
    case "in":
      return unknownPrimitiveValue("boolean", `${operator} on dynamic values`);
    case "+": {
      const isString =
        (left.kind === "primitive" && typeof left.value === "string") ||
        (right.kind === "primitive" && typeof right.value === "string") ||
        (left.kind === "unknown-primitive" && left.primitiveType === "string") ||
        (right.kind === "unknown-primitive" && right.primitiveType === "string");
      return isString
        ? concatenateStrings(left, right)
        : unknownPrimitiveValue("any", "+ on dynamic values");
    }
    default:
      return unknownPrimitiveValue("number", `${operator} on dynamic values`);
  }
};

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

/** Loose equality only differs from identity when both sides can coerce; null, undefined and symbols never do. */
const mayCoerce = (value: StaticValue): boolean =>
  value.kind === "primitive"
    ? value.value !== null && value.value !== undefined
    : value.kind !== "symbol";

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
  if (isEqual === false && !isStrict && mayCoerce(left) && mayCoerce(right)) isEqual = null;
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
