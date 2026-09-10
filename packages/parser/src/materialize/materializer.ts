import { createHash } from "node:crypto";
import type { Class } from "oxc-parser";
import type { ComponentClass, ComponentType, Context, ExoticComponent, ReactNode } from "react";
import {
  getComponentProperty,
  getMaskedLegacyContext,
  isErrorBoundaryClass,
  renderClassComponent,
  unmountClassInstance,
} from "../evaluate/class-component.js";
import type { ContextReader, EvaluationContext } from "../evaluate/context.js";
import { isUserDrivenEventHandlerProp } from "../evaluate/event-listeners.js";
import { getRepeatCardinality } from "../evaluate/predicates.js";
import { ComponentKindError } from "../errors.js";
import { normalizePredicate, parseSymbolicPredicate } from "../harness/symbolic-tree.js";
import { providedContextValue } from "../evaluate/react-calls.js";
import {
  beginHookPass,
  commitEffects,
  commitHookPass,
  createHookFrame,
  type EffectCall,
  giveUpOnHookPass,
  type HookFrame,
  mountAllEffects,
  runChangedEffects,
  unmountAllEffects,
} from "../evaluate/hooks.js";
import type { Interpreter } from "../evaluate/interpreter.js";
import { getModeledPromise, type ModeledPromise, onPromiseSettled } from "../evaluate/promises.js";
import { describeThrow, findThrown, getThrowCertainty, withoutThrows } from "../evaluate/thrown.js";
import {
  areValuesEquivalent,
  compareIdentity,
  compareShallowly,
  describeElementType,
  describeValue,
  getObjectProperty,
  getStubDisplayName,
  mapValue,
  NULL_VALUE,
  objectFromRecord,
  omitObjectKeys,
  unknownValue,
  nativeObjectValue,
} from "../evaluate/values.js";
import { formatSourceLocation } from "../parse/source-location.js";
import { isClientModule } from "../graph/module-record.js";
import { getFunctionComponent } from "../react/element-type.js";
import type {
  ComponentDefinition,
  ContextDefinition,
  PinnedBranchDecision,
  PinnedDecisions,
  RenderEnvironment,
  Scope,
  SourceLocation,
  StaticBranchValue,
  StaticClassValue,
  StaticElementType,
  StaticElementValue,
  StaticFunctionValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticRepeatValue,
  StaticValue,
  StubComponent,
  StubHooks,
  StubRenderTools,
  WrapperElementType,
} from "../types.js";
import { ClassComponentTag, ForwardRefTag, type WorkTag } from "../work-tags.js";
import {
  AlternativeMarker,
  BranchMarker,
  createSuspendedMarker,
  KEY_PLACEHOLDER,
  MARKER_NAMES,
  OpaqueMarker,
  RepeatMarker,
  TEXT_PLACEHOLDER,
  TextMarker,
  UnknownMarker,
} from "./markers.js";
import type { ReactRuntime } from "./react-runtime.js";
import type { RendererHost } from "./renderer-host.js";
import { ServerEnvironmentStamper } from "./server-environment.js";

/**
 * Whether React would take the input for the proxy's `current` props: the same
 * element, or for `React.memo` (`updateSimpleMemoComponent`) shallow-equal props
 * and the same ref. The proxy receives a fresh `input` object each render, so
 * React's own `shallowEqual` on the proxy props never bails out by itself.
 */
const isRetainedInput = (committed: ProxyInput, next: ProxyInput): boolean =>
  committed === next ||
  (next.isMemoized &&
    compareShallowly(committed.props, next.props) === true &&
    (committed.ref === null || next.ref === null
      ? committed.ref === next.ref
      : compareIdentity(committed.ref, next.ref) === true));

const DEFAULT_MAX_COMPONENT_DEPTH = 512;
const DEFAULT_MAX_ELEMENT_COUNT = 50_000;
const DEFAULT_MAX_RECURSION_PER_COMPONENT = 16;
// React's NESTED_UPDATE_LIMIT: effect-raised update chains settle within this or loop.
const MAX_RENDER_PASSES = 50;
const MAX_RENDER_PHASE_UPDATES = 25;
// Every alternative of a branch is materialized, so nested branches multiply the
// work; deviations from the preferred path deeper than this become wildcards.
const MAX_ALTERNATIVE_DEPTH = 2;

export interface MaterializerOptions {
  maxComponentDepth?: number;
  maxFiberCount?: number;
  maxRecursionPerComponent?: number;
  serverComponents?: boolean;
  /** Selects one alternative per pinned branch and one count per pinned repeat instead of rendering them all. */
  decisions?: PinnedDecisions;
}

/**
 * Where decisions are numbered and pinned decisions looked up: the root, one
 * alternative, one iteration, or one render pass of a proxy. Decision ids digest
 * `<prefix><location or reason>#<ordinal>` in materialization order within the
 * scope; the prefix names the proxy whose render claimed them, so a re-render
 * of the proxy and a replay along the chosen path number them the same way.
 */
export interface DecisionScope {
  pins: PinnedDecisions | null;
  ordinals: Map<string, number>;
  prefix: string;
}

/**
 * Mutable per-Suspense-boundary record; `maySuspend` is set while materializing
 * something in the primary subtree that can suspend, and `commit` tells the
 * boundary so in the layout phase of whichever proxy rendered it.
 */
interface SuspenseScope {
  maySuspend: boolean;
  commit: () => void;
}

interface CompositeFrame {
  node: ComponentDefinition["node"];
  /** Closure the component was created in: a factory's components share a node but not a scope. */
  scope: Scope;
  props: StaticValue;
}

/**
 * Everything about a position in the tree that React does not carry for us:
 * the static context values in scope, the RSC environment, and the guards
 * against runaway recursion.
 */
interface MaterializeContext {
  depth: number;
  componentStack: CompositeFrame[];
  suspenseScope: SuspenseScope | null;
  environment: RenderEnvironment | null;
  errorBoundaryDepth: number;
  /** Set while an error boundary re-renders the path on which its child did not throw. */
  ignoresMaybeThrows: boolean;
  /** How many non-preferred branch alternatives enclose this node. */
  alternativeDepth: number;
  /** The component whose render produced this position; host refs are committed into it. */
  owner: EvaluationContext | null;
  /** Inside a `<StrictMode>` subtree, where development React double-invokes hook factories. */
  isStrictMode: boolean;
  decisions: DecisionScope;
  /** The unmasked legacy context (`contextStackCursor`) at this position; null once React dropped legacy context. */
  legacyContext: StaticValue | null;
}

/** The static element a proxy component stands for, handed to it as its only prop. */
interface ProxyInput {
  props: StaticObjectValue;
  ref: StaticValue | null;
  location: SourceLocation | null;
  context: MaterializeContext;
  /** Wrapped in `React.memo` without a custom compare, so shallow-equal props bail out. */
  isMemoized: boolean;
  /** Prefix of the decision ids claimed while this proxy renders. */
  decisionPrefix: string;
}

interface ProxyProps {
  input: ProxyInput;
}

interface ErrorBoundaryState {
  caught: StaticThrowError | null;
}

/**
 * Per-instance bookkeeping a proxy keeps across React renders.
 *
 * `isRenderedSinceCommit` tells the proxy's own effects apart: after a render
 * they commit the changed static effects; without one they are Strict Mode's
 * `doubleInvokeEffectsOnFiber` or a deletion, which unmount and remount them all.
 * `rendered` is the latest render, committed or not: Strict Mode invokes the
 * component again before React decides on `bailoutOnAlreadyFinishedWork`, and
 * that invocation must reproduce the first one's output rather than re-evaluate.
 */
interface ProxyInstance {
  frame: HookFrame;
  passCount: number;
  isRenderedSinceCommit: boolean;
  committed: CommittedRender | null;
  rendered: CommittedRender | null;
}

/** One context value a render read, so the next render can tell whether it changed. */
interface ContextRead {
  definition: ContextDefinition;
  value: StaticValue | null;
}

/** What a proxy last committed (its `current`), so an update that changes nothing bails out as React's would. */
interface CommittedRender {
  input: ProxyInput;
  context: MaterializeContext;
  node: ReactNode;
  contextReads: ContextRead[];
  componentContext: EvaluationContext | null;
}

interface EffectPhaseWork {
  mount: (isLayout: boolean) => void;
  unmount: (isLayout: boolean) => void;
}

interface StatefulRender extends EffectPhaseWork {
  node: ReactNode;
}

/** How a class proxy instance hands its persistent state and commit hooks to the materializer. */
/** Which of an error boundary's renders a proxy instance belongs to; each keeps its own hook frame. */
type BoundaryRenderPath = "rendered" | "ignoring-maybe-throws" | "caught";

interface ClassProxyHost {
  getInstance: (path: BoundaryRenderPath) => ProxyInstance;
  rerender: () => void;
  queueCommitWork: (work: EffectPhaseWork) => void;
}

const createProxyInstance = (
  context: MaterializeContext,
  interpreter: Interpreter,
): ProxyInstance => ({
  frame: createHookFrame(
    context.isStrictMode && interpreter.doesStrictModeDoubleInvokeHookFactories,
    (cell) => interpreter.recordStateUpdate(cell),
  ),
  passCount: 0,
  isRenderedSinceCommit: false,
  committed: null,
  rendered: null,
});

interface CompositeEvaluation {
  rendered: StaticValue;
  childContext: MaterializeContext;
  componentContext: EvaluationContext | null;
}

/**
 * Where React's `reconcileChildFibers` sees a value: at the `top` an array is
 * the children list (nested arrays become Fragment fibers) and one unkeyed
 * fragment is unwrapped; its children then sit `unwrapped`, still the children
 * list but a fragment among them stays a fiber (a marker returns it from the
 * top, so it is keyed with the placeholder to mount).
 */
type ChildPosition = "top" | "unwrapped" | "nested";

interface MaterializedElement {
  context: MaterializeContext;
  position: ChildPosition;
  node: ReactNode;
}

/** The callback React sees for one static ref; its identity is what decides whether React re-attaches. */
interface HostRefBinding {
  owner: EvaluationContext;
  location: SourceLocation | null;
  callback: (node: Element | null) => void;
}

const isSameFrame = (first: CompositeFrame, second: CompositeFrame): boolean =>
  first.node === second.node && first.scope === second.scope && first.props === second.props;

/** Whether two contexts describe the same tree position; the owner differs between renders of one component. */
const isSamePosition = (first: MaterializeContext, second: MaterializeContext): boolean =>
  first.depth === second.depth &&
  first.suspenseScope === second.suspenseScope &&
  first.environment === second.environment &&
  first.errorBoundaryDepth === second.errorBoundaryDepth &&
  first.ignoresMaybeThrows === second.ignoresMaybeThrows &&
  first.alternativeDepth === second.alternativeDepth &&
  first.decisions.pins === second.decisions.pins &&
  first.componentStack.length === second.componentStack.length &&
  first.componentStack.every((frame, index) => isSameFrame(frame, second.componentStack[index]));

/** Thrown by a proxy whose static render evaluates to a thrown value, so React's error boundaries take over. */
class StaticThrowError extends Error {
  readonly isMaybe: boolean;

  constructor(reason: string, isMaybe: boolean) {
    super(reason);
    this.name = "StaticThrowError";
    this.isMaybe = isMaybe;
  }
}

const isClientComponent = (component: ComponentDefinition): boolean =>
  component.isClientReference || isClientModule(component.module);

const isClassNode = (node: ComponentDefinition["node"]): node is Class =>
  node.type === "ClassDeclaration" || node.type === "ClassExpression";

/**
 * Under RSC a function component created by server code renders on the server
 * unless its module opted into the client bundle with `"use client"`. Flight
 * looks through `memo` and a resolved `lazy` and calls a `forwardRef` render
 * function directly (react-server/src/ReactFlightServer.js `renderElement`), so
 * those wrappers leave no fiber either.
 */
const getServerComponent = (type: StaticElementType): ComponentDefinition | null => {
  if (type.kind === "lazy") return type.inner ? getServerComponent(type.inner) : null;
  const component = getFunctionComponent(type);
  return component && !isClientComponent(component) ? component : null;
};

const NOT_SERVER_RENDERED = Symbol("not-server-rendered");

const isKeyless = (key: StaticValue | null): boolean =>
  !key || (key.kind === "primitive" && (key.value === null || key.value === undefined));

/**
 * A component's React identity is its closure: the same function node evaluated
 * in two scopes (e.g. a HOC applied twice) yields two distinct component types,
 * as does each `bind` of the same function.
 */
const getComponentIdentity = (component: ComponentDefinition): Scope | StaticValue[] =>
  component.boundArgs ?? component.scope;

class ComponentCache<T> {
  private readonly byNode = new WeakMap<
    ComponentDefinition["node"],
    WeakMap<Scope | StaticValue[], T>
  >();

  get(component: ComponentDefinition): T | undefined {
    return this.byNode.get(component.node)?.get(getComponentIdentity(component));
  }

  set(component: ComponentDefinition, value: T): void {
    let byIdentity = this.byNode.get(component.node);
    if (!byIdentity) {
      byIdentity = new WeakMap();
      this.byNode.set(component.node, byIdentity);
    }
    byIdentity.set(getComponentIdentity(component), value);
  }
}

const describeComponent = (component: ComponentDefinition): string =>
  component.name ?? "anonymous component";

const isEmptyChild = (value: StaticValue): boolean =>
  (value.kind === "primitive" &&
    (value.value === null || value.value === undefined || typeof value.value === "boolean")) ||
  (value.kind === "unknown-primitive" && value.primitiveType === "boolean");

/** Alternatives that all render nothing (`false`, `null`, `undefined`, an unknown boolean) are one child-list outcome, so a branch without a shared predicate keeps only the first of them. */
const collapseEmptyAlternatives = (
  value: StaticBranchValue,
): Pick<StaticBranchValue, "alternatives" | "preferredIndex"> => {
  if (value.predicate !== null) return value;
  const alternatives: StaticValue[] = [];
  let preferredIndex = 0;
  let emptyIndex = -1;
  value.alternatives.forEach((alternative, index) => {
    let position = alternatives.length;
    if (isEmptyChild(alternative)) {
      if (emptyIndex === -1) {
        emptyIndex = position;
        alternatives.push(alternative);
      } else position = emptyIndex;
    } else alternatives.push(alternative);
    if (index === value.preferredIndex) preferredIndex = position;
  });
  return { alternatives, preferredIndex };
};

const isNonNullish = (value: StaticValue): boolean =>
  !(value.kind === "primitive" && (value.value === null || value.value === undefined));

// A lone text child is written as textContent; React creates no HostText fiber for it.
const isTextContentChild = (children: StaticValue): boolean => {
  if (children.kind === "primitive") {
    const value = children.value;
    return typeof value === "string" || typeof value === "number" || typeof value === "bigint";
  }
  return (
    children.kind === "unknown-primitive" &&
    (children.primitiveType === "string" || children.primitiveType === "number")
  );
};

const textContentToNull = (value: StaticValue): StaticValue => {
  if (value.kind === "optional") return { ...value, value: textContentToNull(value.value) };
  if (value.kind === "branch") return mapValue(value, textContentToNull);
  return isTextContentChild(value) ? NULL_VALUE : value;
};

const getComponentDisplayName = (component: ComponentDefinition): string | null => {
  const displayName = getComponentProperty(component, "displayName");
  if (displayName?.kind === "primitive" && typeof displayName.value === "string")
    return displayName.value;
  return component.name;
};

const hasDefaultProps = (component: ComponentDefinition): boolean => {
  const defaults = getComponentProperty(component, "defaultProps");
  return defaults !== null && isNonNullish(defaults);
};

/** `createElement` fills in a default for every prop that is missing or explicitly `undefined`. */
const withDefaultProps = (
  defaults: StaticValue | null,
  props: StaticObjectValue,
): StaticObjectValue => {
  if (!defaults || !isNonNullish(defaults)) return props;
  const isDefaulted = (entry: StaticObjectEntry): boolean =>
    entry.kind === "property" &&
    defaults.kind === "object" &&
    entry.value.kind === "primitive" &&
    entry.value.value === undefined &&
    isNonNullish(getObjectProperty(defaults, entry.key));
  return {
    kind: "object",
    entries: [
      { kind: "spread", value: defaults },
      ...props.entries.filter((entry) => !isDefaulted(entry)),
    ],
  };
};

const applyDefaultProps = (
  component: ComponentDefinition,
  props: StaticObjectValue,
): StaticObjectValue => withDefaultProps(getComponentProperty(component, "defaultProps"), props);

/** `createElement` fills in `type.defaultProps` of a `memo`/`forwardRef` object like any other type's. */
const applyWrapperDefaultProps = (
  type: WrapperElementType,
  props: StaticObjectValue,
): StaticObjectValue => withDefaultProps(type.properties.get("defaultProps") ?? null, props);

const toFunctionValue = (component: ComponentDefinition): StaticFunctionValue => {
  const node = component.node;
  if (isClassNode(node)) {
    throw new ComponentKindError(`${describeComponent(component)} is a class component`);
  }
  return {
    kind: "function",
    node,
    scope: component.scope,
    module: component.module,
    thisValue: null,
    superBinding: null,
    name: component.name,
    properties: component.properties,
    boundArgs: component.boundArgs,
    boundThis: component.boundThis,
    isClientReference: component.isClientReference,
  };
};

const toClassValue = (component: ComponentDefinition): StaticClassValue => {
  if (!component.classBody) {
    throw new ComponentKindError(`${describeComponent(component)} is not a class component`);
  }
  return {
    kind: "class",
    node: component.node,
    body: component.classBody,
    scope: component.scope,
    module: component.module,
    name: component.name,
    properties: component.properties,
    isClientReference: component.isClientReference,
  };
};

const setFunctionName = <T extends object>(target: T, name: string | null): T =>
  Object.defineProperty(target, "name", { value: name ?? "" });

// React's built-in types are symbols (Fragment, Activity) or `$$typeof` objects.
const isExoticComponent = (value: unknown): value is ExoticComponent<{ children?: ReactNode }> =>
  typeof value === "symbol" || (typeof value === "object" && value !== null && "$$typeof" in value);

const EXOTIC_EXPORT_NAMES: Record<"suspense-list" | "activity" | "view-transition", string[]> = {
  "suspense-list": ["SuspenseList", "unstable_SuspenseList"],
  activity: ["Activity", "unstable_Activity"],
  "view-transition": ["ViewTransition", "unstable_ViewTransition"],
};

const noop = (): void => {};

const createDecisionScope = (pins: PinnedDecisions | null, prefix = ""): DecisionScope => ({
  pins,
  ordinals: new Map(),
  prefix,
});

const DECISION_ID_LENGTH = 16;

/** Digest of the structural path so the id stays short enough to survive snapshot prop truncation. */
const toDecisionId = (structuralPath: string): string =>
  createHash("sha256").update(structuralPath).digest("base64url").slice(0, DECISION_ID_LENGTH);

/** The pinned alternative in the materializer's order; the pattern reader stores a negated predicate's branch swapped. */
const selectPinnedAlternative = (
  pinned: PinnedBranchDecision,
  predicate: string | null,
  alternativeCount: number,
): number | null => {
  const index =
    predicate !== null &&
    normalizePredicate(parseSymbolicPredicate(predicate), alternativeCount).isSwapped
      ? 1 - pinned.alternativeIndex
      : pinned.alternativeIndex;
  return index >= 0 && index < alternativeCount ? index : null;
};

/**
 * Turns the interpreter's values into real React elements. Host elements and
 * React's own types map directly; source components become proxy components
 * that hand their props back to the interpreter when React renders them, so
 * React constructs every fiber with its own reconciler while no application
 * code runs. Where the source does not pin down one tree, marker components
 * (`$Branch`, `$Repeat`, `$Opaque`, `$Unknown`) record the alternatives.
 */
export class Materializer {
  readonly interpreter: Interpreter;
  readonly runtime: ReactRuntime;
  readonly host: RendererHost<Element>;
  private materializedCount = 0;
  private readonly maxComponentDepth: number;
  private readonly maxElementCount: number;
  private readonly maxRecursionPerComponent: number;
  private readonly serverComponents: boolean;
  private readonly serverEnvironment = new ServerEnvironmentStamper();
  private isBudgetExhausted = false;
  /** Set by the first layout effect of a commit, cleared by its first passive effect. */
  private isPassivePhasePending = false;
  /** A state update was raised in the layout phase, so React renders it synchronously. */
  private isSyncRenderScheduled = false;
  /** The current commit was rendered synchronously, so React flushes its passive effects in the same task. */
  private isSyncCommit = false;
  private readonly functionProxies = new ComponentCache<ComponentType<ProxyProps>>();
  private readonly classProxies = new ComponentCache<ComponentClass<ProxyProps>>();
  private readonly forwardRefProxies = new ComponentCache<Map<string, ComponentType<ProxyProps>>>();
  private readonly memoTypes = new WeakMap<object, Map<string, ComponentType<ProxyProps>>>();
  private readonly lazyTypes = new WeakMap<object, ComponentType<ProxyProps>>();
  private readonly wakeables = new WeakMap<ModeledPromise, Promise<void>>();
  private readonly contexts = new WeakMap<
    ContextDefinition | StaticElementType,
    Context<StaticValue | null>
  >();
  private isInsideComponentRender = false;
  /** Context values flow through React itself, so a proxy reads them at its own fiber, as the real hook would. */
  private readonly readContext: ContextReader = (definition) => {
    if (!this.isInsideComponentRender) return null;
    const value = this.runtime.readContext(this.getContext(definition));
    this.contextReads?.push({ definition, value });
    return value;
  };
  private contextReads: ContextRead[] | null = null;
  private readonly stubProxies = new WeakMap<StubComponent, ComponentType<ProxyProps>>();
  private readonly suspenseBoundaryProxy: ComponentType<ProxyProps>;
  private readonly suspendedMarker: ComponentType;
  private portalContainer: Element | null = null;
  private readonly hostRefs = new WeakMap<StaticValue, HostRefBinding>();
  private readonly materializedElements = new WeakMap<StaticElementValue, MaterializedElement[]>();
  private readonly pinnedDecisions: PinnedDecisions | null;

  constructor(
    interpreter: Interpreter,
    runtime: ReactRuntime,
    host: RendererHost<Element>,
    options: MaterializerOptions = {},
  ) {
    this.interpreter = interpreter;
    this.runtime = runtime;
    this.host = host;
    this.pinnedDecisions = options.decisions ?? null;
    this.maxComponentDepth = options.maxComponentDepth ?? DEFAULT_MAX_COMPONENT_DEPTH;
    this.maxElementCount = options.maxFiberCount ?? DEFAULT_MAX_ELEMENT_COUNT;
    this.maxRecursionPerComponent =
      options.maxRecursionPerComponent ?? DEFAULT_MAX_RECURSION_PER_COMPONENT;
    this.serverComponents = options.serverComponents ?? false;
    this.suspenseBoundaryProxy = setFunctionName(
      ({ input }: ProxyProps): ReactNode => this.renderSuspenseBoundary(input),
      MARKER_NAMES.suspenseBoundary,
    );
    this.suspendedMarker = createSuspendedMarker(runtime.react.use);
  }

  createRootContext(): MaterializeContext {
    return {
      depth: 0,
      componentStack: [],
      suspenseScope: null,
      environment: this.serverComponents ? "server" : null,
      errorBoundaryDepth: 0,
      ignoresMaybeThrows: false,
      alternativeDepth: 0,
      owner: null,
      isStrictMode: false,
      decisions: createDecisionScope(this.pinnedDecisions),
      legacyContext: this.interpreter.hasLegacyContext ? objectFromRecord({}) : null,
    };
  }

  /** The element budget bounds the elements between two commits, so re-renders do not consume it. */
  resetElementBudget(): void {
    this.materializedCount = 0;
  }

  /** The React element tree for a root value, as `root.render(...)` would receive it. */
  toRootNode(value: StaticValue): ReactNode {
    return this.toNode(value, this.createRootContext(), "top");
  }

  toNode(value: StaticValue, context: MaterializeContext, position: ChildPosition): ReactNode {
    switch (value.kind) {
      case "primitive": {
        const primitive = value.value;
        if (typeof primitive === "string" || typeof primitive === "number") {
          return primitive;
        }
        return typeof primitive === "bigint" ? primitive.toString() : null;
      }
      case "unknown-primitive":
        if (value.primitiveType === "string" || value.primitiveType === "number") {
          return this.runtime.react.createElement(TextMarker);
        }
        if (value.primitiveType === "boolean") return null;
        return this.unknownNode(`dynamic child (${value.reason})`);
      case "element":
        return this.elementToNode(value, context, position);
      case "list":
        return value.items.map((item) => this.toNode(item, context, "nested"));
      case "repeat":
        return this.repeatNode(value, context);
      case "branch": {
        if (value.alternatives.every(isEmptyChild)) return null;
        const { alternatives, preferredIndex } = collapseEmptyAlternatives(value);
        return this.branchNode(
          context,
          alternatives.map(
            (alternative, index) => (alternativeContext: MaterializeContext) =>
              this.alternativeNode(
                alternative,
                index === preferredIndex,
                alternativeContext,
                position,
              ),
          ),
          value.reason,
          preferredIndex,
          position,
          value.location,
          value.predicate,
        );
      }
      case "optional":
        return this.branchNode(
          context,
          [
            (alternativeContext) => this.toNode(value.value, alternativeContext, position),
            () => null,
          ],
          value.reason,
          value.isAbsentPreferred ? 1 : 0,
          position,
          value.location,
        );
      case "unknown":
        return this.unknownNode(value.reason);
      case "external":
        return this.unknownElementNode(
          `value from ${value.packageName} (${value.importedName})`,
          context,
        );
      default:
        return this.unknownNode(`${describeValue(value)} is not a valid React child`);
    }
  }

  private alternativeNode(
    value: StaticValue,
    isPreferred: boolean,
    context: MaterializeContext,
    position: ChildPosition,
  ): ReactNode {
    if (isPreferred) return this.toNode(value, context, position);
    if (context.alternativeDepth >= MAX_ALTERNATIVE_DEPTH) {
      return this.unknownNode(
        `alternative nested ${MAX_ALTERNATIVE_DEPTH} branches away from the preferred path`,
        true,
      );
    }
    return this.toNode(
      value,
      { ...context, alternativeDepth: context.alternativeDepth + 1 },
      position,
    );
  }

  private claimDecision(context: MaterializeContext, key: string): string {
    const ordinal = context.decisions.ordinals.get(key) ?? 0;
    context.decisions.ordinals.set(key, ordinal + 1);
    return toDecisionId(`${context.decisions.prefix}${key}#${ordinal}`);
  }

  /** The context one render pass of a proxy materializes in; every pass numbers its decisions afresh. */
  private renderContext(input: ProxyInput): MaterializeContext {
    return {
      ...input.context,
      decisions: createDecisionScope(input.context.decisions.pins, input.decisionPrefix),
    };
  }

  private repeatNode(value: StaticRepeatValue, context: MaterializeContext): ReactNode {
    const location = value.location && formatSourceLocation(value.location);
    const decision = this.claimDecision(context, location ?? "repeat");
    const pinned = context.decisions.pins?.repeats.get(decision) ?? null;
    const iterationScopes = pinned
      ? pinned.iterations.map((pins) => createDecisionScope(pins))
      : [createDecisionScope(null)];
    return this.runtime.react.createElement(RepeatMarker, {
      location,
      decision,
      sharesScope: false,
      cardinality: getRepeatCardinality(value),
      countMin: value.count?.min ?? 0,
      countMax: value.count?.max ?? null,
      pinnedCount: pinned ? pinned.iterations.length : null,
      children: iterationScopes.map((decisions) =>
        this.toNode(value.item, { ...context, decisions }, "nested"),
      ),
    });
  }

  /**
   * A branch marker over its alternatives, each materialized in a decision
   * scope of its own; with `sharesScope` the alternatives were materialized in
   * `context` already and only the choice between them is recorded. A replay
   * that pinned the decision renders the chosen alternative alone.
   */
  private branchNode(
    context: MaterializeContext,
    alternatives: Array<(alternativeContext: MaterializeContext) => ReactNode>,
    reason: string,
    preferredIndex: number | null,
    position: ChildPosition,
    location: SourceLocation | null = null,
    predicate: string | null = null,
    sharesScope = false,
  ): ReactNode {
    const { createElement } = this.runtime.react;
    const formattedLocation = location && formatSourceLocation(location);
    const decision = this.claimDecision(context, formattedLocation ?? reason);
    const pinned = context.decisions.pins?.branches.get(decision) ?? null;
    const pinnedIndex = pinned && selectPinnedAlternative(pinned, predicate, alternatives.length);
    const alternativeContext = (pins: PinnedDecisions | null): MaterializeContext =>
      sharesScope ? context : { ...context, decisions: createDecisionScope(pins) };
    const rendered =
      pinned === null || pinnedIndex === null
        ? alternatives.map((alternative) => alternative(alternativeContext(null)))
        : [alternatives[pinnedIndex](alternativeContext(pinned.inside))];
    return createElement(BranchMarker, {
      reason,
      location: formattedLocation,
      decision,
      sharesScope,
      preferredIndex,
      predicate,
      pinnedIndex,
      children: rendered.map((node, index) =>
        createElement(AlternativeMarker, {
          key: pinnedIndex ?? index,
          children: position === "nested" ? [node] : node,
        }),
      ),
    });
  }

  private unknownNode(reason: string, isTruncated = false): ReactNode {
    return this.runtime.react.createElement(UnknownMarker, { reason, isTruncated });
  }

  /** An element whose component is not known may suspend (a `use()` or lazy inside it). */
  private unknownElementNode(reason: string, context: MaterializeContext): ReactNode {
    this.markMaySuspend(context);
    return this.unknownNode(reason);
  }

  private markMaySuspend(context: MaterializeContext): void {
    if (context.suspenseScope) context.suspenseScope.maySuspend = true;
  }

  private commitSuspenseScope(scope: SuspenseScope | null): void {
    if (scope?.maySuspend) scope.commit();
  }

  /**
   * React bails a child out of re-rendering only when it receives the very same
   * element object, so a static element materialized again at the same
   * position must yield the element it produced before.
   */
  private elementToNode(
    element: StaticElementValue,
    context: MaterializeContext,
    position: ChildPosition,
  ): ReactNode {
    let materialized = this.materializedElements.get(element);
    if (!materialized) {
      materialized = [];
      this.materializedElements.set(element, materialized);
    }
    const previous = materialized.find(
      (candidate) => candidate.position === position && isSamePosition(candidate.context, context),
    );
    if (previous) return previous.node;
    const node = this.freshElementToNode(element, context, position);
    materialized.push({ context, position, node });
    return node;
  }

  private freshElementToNode(
    element: StaticElementValue,
    context: MaterializeContext,
    position: ChildPosition,
  ): ReactNode {
    if (this.isServerEnvironment(element, context)) {
      const serverNode = this.serverElementToNode(element, context, position);
      if (serverNode !== NOT_SERVER_RENDERED) return serverNode;
    }
    if (!this.isServerEnvironment(element, context)) {
      return this.createNode(
        element.type,
        element.key,
        element.props,
        element.location,
        context,
        position,
      );
    }
    if (this.isFlightUnwrappedFragment(element)) {
      return this.toNode(getObjectProperty(element.props, "children"), context, position);
    }
    const props = this.serverEnvironment.stampProps(element.props);
    return this.createNode(element.type, element.key, props, element.location, context, position);
  }

  /** Flight serializes a key-less server `<>...</>` as its children, so the client never sees the fragment. */
  private isFlightUnwrappedFragment(element: StaticElementValue): boolean {
    return element.type.kind === "fragment" && isKeyless(element.key);
  }

  /**
   * What Flight sends the client for an element server code created: a key-less
   * Fragment is flattened to its children (`renderElement` in
   * react-server/src/ReactFlightServer.js), and a server component's output
   * replaces it.
   */
  private serverElementToNode(
    element: StaticElementValue,
    context: MaterializeContext,
    position: ChildPosition,
  ): ReactNode | typeof NOT_SERVER_RENDERED {
    const { type, props, location } = element;
    const serverContext: MaterializeContext = {
      ...context,
      environment: element.environment ?? context.environment,
    };
    if (type.kind === "fragment" && isKeyless(element.key)) {
      return this.toNode(getObjectProperty(props, "children"), serverContext, position);
    }
    if (type.kind === "stub" && type.stub.isServerComponent) {
      const rendered = type.stub.render(props, this.stubTools(serverContext, location));
      return this.toNode(rendered, { ...serverContext, depth: context.depth + 1 }, position);
    }
    const serverComponent = getServerComponent(type);
    if (!serverComponent) return NOT_SERVER_RENDERED;
    const server = this.evaluateComposite(
      serverComponent,
      props,
      serverContext,
      location,
      null,
      (componentContext) =>
        this.interpreter.callFunction(toFunctionValue(serverComponent), [props], componentContext, {
          awaited: true,
        }),
    );
    return this.toNode(server.rendered, server.childContext, position);
  }

  private createNode(
    type: StaticElementType,
    key: StaticValue | null,
    props: StaticObjectValue,
    location: SourceLocation | null,
    context: MaterializeContext,
    position: ChildPosition,
  ): ReactNode {
    const { createElement } = this.runtime.react;
    if (type.kind !== "fragment" && this.materializedCount++ >= this.maxElementCount) {
      if (!this.isBudgetExhausted) {
        this.isBudgetExhausted = true;
        this.interpreter.report(
          "max-fiber-count",
          `element budget of ${this.maxElementCount} exhausted`,
          null,
          "warning",
        );
      }
      return this.unknownNode("element budget exhausted", true);
    }
    const reactKey = this.keyToString(key, location);
    const children = getObjectProperty(props, "children");
    const proxyInput = (): ProxyInput => ({
      props,
      ref: null,
      location,
      context,
      isMemoized: false,
      decisionPrefix: `${this.claimDecision(context, describeElementType(type))}/`,
    });
    switch (type.kind) {
      case "host":
        return createElement(
          type.tagName,
          this.hostProps(type.tagName, props, reactKey, location, context),
        );
      case "function":
        return createElement(this.getFunctionProxy(type.component), {
          key: reactKey,
          input: proxyInput(),
        });
      case "class":
        return createElement(this.getClassProxy(type.component), {
          key: reactKey,
          input: proxyInput(),
        });
      case "memo": {
        const memoType = this.getMemoType(type);
        if (!memoType)
          return this.unknownElementNode(`memo of ${type.inner.kind} element type`, context);
        return createElement(memoType, {
          key: reactKey,
          input: {
            ...proxyInput(),
            props: applyWrapperDefaultProps(type, props),
            isMemoized: !type.hasCompare,
          },
        });
      }
      case "forward-ref": {
        const ref = getObjectProperty(props, "ref");
        const renderProps = omitObjectKeys(props, new Set(["ref"]));
        return createElement(this.getForwardRefProxy(type), {
          key: reactKey,
          input: {
            ...proxyInput(),
            props: applyWrapperDefaultProps(
              type,
              renderProps.kind === "object" ? renderProps : props,
            ),
            ref: ref.kind === "primitive" && ref.value === undefined ? NULL_VALUE : ref,
          },
        });
      }
      case "lazy": {
        const lazyType = this.getLazyType(type);
        if (!lazyType) {
          return this.unknownElementNode(
            type.inner
              ? `lazy of ${type.inner.kind} element type`
              : "lazy component target could not be resolved statically",
            context,
          );
        }
        return createElement(lazyType, { key: reactKey, input: proxyInput() });
      }
      case "fragment": {
        const isUnwrapped = position === "top" && reactKey === undefined;
        const fragmentKey = isKeyless(key)
          ? position === "unwrapped"
            ? KEY_PLACEHOLDER
            : undefined
          : (reactKey ?? KEY_PLACEHOLDER);
        return createElement(
          this.runtime.react.Fragment,
          { key: fragmentKey },
          this.toNode(children, context, isUnwrapped ? "unwrapped" : "top"),
        );
      }
      case "strict-mode":
        return createElement(
          this.runtime.react.StrictMode,
          { key: reactKey },
          this.toNode(children, { ...context, isStrictMode: true }, "top"),
        );
      case "profiler": {
        const id = this.toAttribute("id", getObjectProperty(props, "id"), context);
        return createElement(
          this.runtime.react.Profiler,
          { key: reactKey, id: typeof id === "string" ? id : "", onRender: noop },
          this.toNode(children, context, "top"),
        );
      }
      case "suspense":
        return createElement(this.suspenseBoundaryProxy, { key: reactKey, input: proxyInput() });
      case "suspense-list":
      case "activity":
      case "view-transition": {
        const exotic = this.getExoticType(type.kind);
        if (!exotic) {
          return this.unknownNode(`${type.kind} is not available in React ${this.runtime.version}`);
        }
        return createElement(exotic, { key: reactKey }, this.toNode(children, context, "top"));
      }
      case "context-provider": {
        const realContext = this.getContext(type.context ?? type);
        this.noteUnresolvedContext(type.context, location);
        return createElement(
          realContext.Provider,
          { key: reactKey, value: type.context ? getObjectProperty(props, "value") : null },
          this.toNode(children, context, "top"),
        );
      }
      case "context-consumer": {
        const realContext = this.getContext(type.context ?? type);
        this.noteUnresolvedContext(type.context, location);
        const input = proxyInput();
        return createElement(realContext.Consumer, {
          key: reactKey,
          children: (provided) =>
            this.renderConsumer(
              type.context,
              provided,
              children,
              this.renderContext(input),
              location,
            ),
        });
      }
      case "portal":
        return this.runtime.dom.createPortal(
          this.toNode(children, context, "top"),
          this.getPortalContainer(type.container),
          reactKey ?? null,
        );
      case "external": {
        this.markMaySuspend(context);
        this.markEscapedExternalProps(props);
        return createElement(OpaqueMarker, {
          key: reactKey,
          displayName: type.displayName,
          importedName: type.importedName,
          packageName: type.packageName,
          reason: `${type.importedName} from ${type.packageName} is not analyzed`,
          children: this.toNode(children, context, "top"),
        });
      }
      case "stub":
        return createElement(this.getStubProxy(type.stub), { key: reactKey, input: proxyInput() });
      case "unknown":
        return this.unknownElementNode(
          `${type.displayName ? `<${type.displayName}>` : "element"}: ${type.reason}`,
          context,
        );
    }
  }

  private renderConsumer(
    definition: ContextDefinition | null,
    provided: StaticValue | null,
    children: StaticValue,
    context: MaterializeContext,
    location: SourceLocation | null,
  ): ReactNode {
    const contextValue = definition
      ? providedContextValue(this.interpreter, definition, provided, location)
      : unknownValue("context value from an unresolved context");
    if (children.kind === "native-function") {
      return this.toNode(
        children.call([contextValue], this.stubTools(context, location)),
        context,
        "top",
      );
    }
    if (children.kind !== "function") {
      return this.unknownElementNode("Consumer render prop is dynamic", context);
    }
    const evaluationContext = this.interpreter.createModuleContext(children.module, (candidate) =>
      candidate === definition ? provided : null,
    );
    return this.toNode(
      this.interpreter.callFunction(children, [contextValue], evaluationContext),
      context,
      "top",
    );
  }

  private getExoticType(
    kind: keyof typeof EXOTIC_EXPORT_NAMES,
  ): ExoticComponent<{ children?: ReactNode }> | null {
    for (const name of EXOTIC_EXPORT_NAMES[kind]) {
      const candidate: unknown = Reflect.get(this.runtime.react, name);
      if (isExoticComponent(candidate)) return candidate;
    }
    return null;
  }

  private hostProps(
    tagName: string,
    props: StaticObjectValue,
    key: string | undefined,
    location: SourceLocation | null,
    context: MaterializeContext,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { key };
    this.collectHostAttributes(props, result, context);
    const ref = this.hostRef(getObjectProperty(props, "ref"), location, context);
    if (ref) result.ref = ref;
    if (this.host.isChildlessTag(tagName)) return result;
    const children = getObjectProperty(props, "children");
    if (!isNonNullish(children)) {
      const innerHtml = getObjectProperty(props, "dangerouslySetInnerHTML");
      if (innerHtml.kind === "unknown" || innerHtml.kind === "external") {
        result.dangerouslySetInnerHTML = { __html: "" };
      }
    }
    if (result.dangerouslySetInnerHTML) return result;
    result.children = this.hostChildren(children, context);
    return result;
  }

  private collectHostAttributes(
    props: StaticObjectValue,
    result: Record<string, unknown>,
    context: MaterializeContext,
  ): void {
    for (const entry of props.entries) {
      if (entry.kind === "spread") {
        if (entry.value.kind === "object") {
          this.collectHostAttributes(entry.value, result, context);
        } else {
          this.interpreter.report(
            "dynamic-props",
            `spread of ${describeValue(entry.value)} into host props`,
            null,
          );
        }
        continue;
      }
      if (entry.key === "key" || entry.key === "ref" || entry.key === "children") continue;
      const attribute = this.toAttribute(entry.key, entry.value, context);
      if (attribute !== undefined) result[entry.key] = attribute;
    }
  }

  /**
   * Host attributes only matter to the fiber tree where React DOM inspects them
   * (hoistable `<link>`/`<meta>`, `dangerouslySetInnerHTML`), so unknown values
   * become representative placeholders of the same type.
   */
  private toAttribute(key: string, value: StaticValue, context: MaterializeContext): unknown {
    switch (value.kind) {
      case "primitive":
        return typeof value.value === "bigint" ? value.value.toString() : value.value;
      case "unknown-primitive":
        if (value.primitiveType === "string") return TEXT_PLACEHOLDER;
        return value.primitiveType === "number" ? 0 : undefined;
      case "object": {
        const record: Record<string, unknown> = {};
        for (const entry of value.entries) {
          if (entry.kind === "spread") {
            const spread = this.toAttribute(key, entry.value, context);
            if (typeof spread === "object" && spread !== null) Object.assign(record, spread);
            continue;
          }
          const inner = this.toAttribute(entry.key, entry.value, context);
          if (inner !== undefined) record[entry.key] = inner;
        }
        if (key === "dangerouslySetInnerHTML" && typeof record.__html !== "string") {
          record.__html = "";
        }
        return record;
      }
      case "list":
        return value.items.map((item) => this.toAttribute(key, item, context));
      case "element":
        return this.toNode(value, context, "nested");
      case "branch": {
        const preferred = value.alternatives[value.preferredIndex ?? 0] ?? value.alternatives[0];
        return preferred ? this.toAttribute(key, preferred, context) : undefined;
      }
      case "optional":
        return value.isAbsentPreferred ? undefined : this.toAttribute(key, value.value, context);
      case "function":
      case "native-function":
      case "method":
      case "proxy":
        return key.startsWith("on") ? noop : undefined;
      default:
        return undefined;
    }
  }

  // Each alternative of a branched `children` prop is its own possible props
  // object, so text-only alternatives set textContent instead of child fibers.
  private hostChildren(children: StaticValue, context: MaterializeContext): ReactNode {
    if (isTextContentChild(children)) {
      return children.kind === "primitive" ? String(children.value) : TEXT_PLACEHOLDER;
    }
    return this.toNode(textContentToNull(children), context, "top");
  }

  private keyToString(
    key: StaticValue | null,
    location: SourceLocation | null,
  ): string | undefined {
    if (!key || isKeyless(key)) return undefined;
    if (key.kind === "primitive") return String(key.value);
    this.interpreter.report("dynamic-key", `key is dynamic (${describeValue(key)})`, location);
    return undefined;
  }

  private noteUnresolvedContext(
    definition: ContextDefinition | null,
    location: SourceLocation | null,
  ): void {
    if (definition === null) {
      this.interpreter.report(
        "unresolved-context",
        "context object could not be resolved",
        location,
      );
    }
  }

  private getContext(key: ContextDefinition | StaticElementType): Context<StaticValue | null> {
    let context = this.contexts.get(key);
    if (!context) {
      context = this.runtime.react.createContext<StaticValue | null>(null);
      if ("displayName" in key && key.displayName) context.displayName = key.displayName;
      this.contexts.set(key, context);
    }
    return context;
  }

  /** What a ref to a host component holds after commit: the document's node, or an instance no document describes. */
  private hostInstanceValue(node: Element | null): StaticValue {
    if (node === null) return NULL_VALUE;
    const host = this.interpreter.hostDocument;
    return host ? nativeObjectValue(node, host) : unknownValue("host instance");
  }

  private hostRef(
    ref: StaticValue,
    location: SourceLocation | null,
    context: MaterializeContext,
  ): ((node: Element | null) => void) | undefined {
    const owner = context.owner;
    if (!owner || !isNonNullish(ref)) return undefined;
    const existing = this.hostRefs.get(ref);
    if (existing) {
      existing.owner = owner;
      existing.location = location;
      return existing.callback;
    }
    const binding: HostRefBinding = {
      owner,
      location,
      callback: (node) => {
        this.interpreter.assignRef(
          ref,
          this.hostInstanceValue(node),
          binding.owner,
          binding.location,
        );
      },
    };
    this.hostRefs.set(ref, binding);
    return binding.callback;
  }

  /** Props of a component that is not analyzed may reach any code, except handlers only a user gesture fires. */
  private markEscapedExternalProps(props: StaticValue): void {
    if (props.kind !== "object") {
      this.interpreter.markEscaped(props);
      return;
    }
    for (const entry of props.entries) {
      if (entry.kind === "spread") this.markEscapedExternalProps(entry.value);
      else if (!isUserDrivenEventHandlerProp(entry.key)) this.interpreter.markEscaped(entry.value);
    }
  }

  /** The host node the program portals into; a detached one stands in for a container the analysis cannot name. */
  private getPortalContainer(container: StaticValue): Element {
    if (container.kind === "native-object" && this.host.isContainer(container.value)) {
      return container.value;
    }
    this.portalContainer ??= this.host.createContainer();
    return this.portalContainer;
  }

  private getFunctionProxy(component: ComponentDefinition): ComponentType<ProxyProps> {
    let proxy = this.functionProxies.get(component);
    if (!proxy) {
      const render = setFunctionName(
        ({ input }: ProxyProps): ReactNode =>
          this.renderInsideComponent(() =>
            this.renderFunctionProxy(input, component, (props) => {
              const legacyContext = input.context.legacyContext;
              const contextArgument =
                legacyContext === null
                  ? null
                  : getMaskedLegacyContext(
                      component.properties.get("contextTypes") ?? null,
                      legacyContext,
                    );
              return contextArgument ? [props, contextArgument] : [props];
            }),
          ),
        getComponentDisplayName(component),
      );
      // React.memo only takes its SimpleMemoComponent fast path when the inner type has no defaultProps.
      proxy = hasDefaultProps(component) ? Object.assign(render, { defaultProps: {} }) : render;
      this.functionProxies.set(component, proxy);
    }
    return proxy;
  }

  private getClassProxy(component: ComponentDefinition): ComponentClass<ProxyProps> {
    let proxy = this.classProxies.get(component);
    if (!proxy) {
      const classValue = toClassValue(component);
      const { interpreter } = this;
      const beginLayoutPhase = (context: MaterializeContext): void => {
        this.beginLayoutPhase();
        this.commitSuspenseScope(context.suspenseScope);
      };
      const renderProxy = (
        input: ProxyInput,
        caught: StaticThrowError | null,
        host: ClassProxyHost,
      ): ReactNode =>
        this.renderInsideComponent(() =>
          this.renderClassProxy(input, component, classValue, caught, host),
        );
      class ClassProxy extends this.runtime.react.Component<ProxyProps, ErrorBoundaryState> {
        state: ErrorBoundaryState = { caught: null };
        private readonly instances = new Map<BoundaryRenderPath, ProxyInstance>();
        private pendingWork: EffectPhaseWork[] = [];
        private committedWork: EffectPhaseWork[] = [];
        private readonly host: ClassProxyHost = {
          getInstance: (path) => {
            let instance = this.instances.get(path);
            if (!instance) {
              instance = createProxyInstance(this.props.input.context, interpreter);
              this.instances.set(path, instance);
            }
            return instance;
          },
          rerender: () => this.forceUpdate(),
          queueCommitWork: (work) => this.pendingWork.push(work),
        };

        render(): ReactNode {
          this.pendingWork = [];
          return renderProxy(this.props.input, this.state.caught, this.host);
        }

        componentDidMount(): void {
          this.mountCommittedWork();
        }

        componentDidUpdate(): void {
          this.mountCommittedWork();
        }

        componentWillUnmount(): void {
          for (const work of this.committedWork) {
            work.unmount(true);
            work.unmount(false);
          }
        }

        /** Strict Mode calls `componentDidMount` again without a render, so the committed work repeats. */
        private mountCommittedWork(): void {
          if (this.pendingWork.length > 0) {
            this.committedWork = this.pendingWork;
            this.pendingWork = [];
          }
          for (const work of this.committedWork) {
            beginLayoutPhase(this.props.input.context);
            work.mount(true);
            work.mount(false);
          }
        }
      }
      class ErrorBoundaryProxy extends ClassProxy {
        static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
          return {
            caught:
              error instanceof StaticThrowError
                ? error
                : new StaticThrowError(
                    error instanceof Error ? error.message : String(error),
                    false,
                  ),
          };
        }
      }
      proxy = setFunctionName(
        isErrorBoundaryClass(classValue) ? ErrorBoundaryProxy : ClassProxy,
        getComponentDisplayName(component),
      );
      this.classProxies.set(component, proxy);
    }
    return proxy;
  }

  private getForwardRefProxy(
    type: Extract<StaticElementType, { kind: "forward-ref" }>,
  ): ComponentType<ProxyProps> {
    let byName = this.forwardRefProxies.get(type.component);
    if (!byName) {
      byName = new Map();
      this.forwardRefProxies.set(type.component, byName);
    }
    const cacheKey = type.displayName ?? "";
    let proxy = byName.get(cacheKey);
    if (!proxy) {
      const component = type.component;
      const forwarded = this.runtime.react.forwardRef<unknown, ProxyProps>(
        setFunctionName(
          // React warns unless a forwardRef render function declares (props, ref).
          ({ input }: ProxyProps, _forwardedRef: unknown): ReactNode =>
            this.renderInsideComponent(() =>
              this.renderFunctionProxy(input, component, (props) => {
                const ref = input.ref ?? NULL_VALUE;
                return type.renderArguments
                  ? type.renderArguments(props, ref, (definition) =>
                      providedContextValue(
                        this.interpreter,
                        definition,
                        this.readContext(definition),
                        input.location,
                      ),
                    )
                  : [props, ref];
              }),
            ),
          getComponentDisplayName(component),
        ),
      );
      if (type.displayName) forwarded.displayName = type.displayName;
      proxy = forwarded;
      byName.set(cacheKey, proxy);
    }
    return proxy;
  }

  /** The real React type for a component-like static type; null for types React would reject. */
  private getComponentType(type: StaticElementType): ComponentType<ProxyProps> | null {
    switch (type.kind) {
      case "function":
        return this.getFunctionProxy(type.component);
      case "class":
        return this.getClassProxy(type.component);
      case "forward-ref":
        return this.getForwardRefProxy(type);
      case "memo":
        return this.getMemoType(type);
      case "lazy":
        return this.getLazyType(type);
      case "stub":
        return this.getStubProxy(type.stub);
      default:
        return null;
    }
  }

  private getMemoType(
    type: Extract<StaticElementType, { kind: "memo" }>,
  ): ComponentType<ProxyProps> | null {
    const inner = this.getComponentType(type.inner);
    if (!inner) return null;
    let byVariant = this.memoTypes.get(inner);
    if (!byVariant) {
      byVariant = new Map();
      this.memoTypes.set(inner, byVariant);
    }
    const hasWrapperDefaults = isNonNullish(type.properties.get("defaultProps") ?? NULL_VALUE);
    const cacheKey = `${type.hasCompare ? "compare" : ""}\u0000${hasWrapperDefaults ? "defaults" : ""}\u0000${type.displayName ?? ""}`;
    let memoType = byVariant.get(cacheKey);
    if (!memoType) {
      const memoized = this.runtime.react.memo(inner, type.hasCompare ? () => false : undefined);
      if (type.displayName) memoized.displayName = type.displayName;
      // React 18 only takes the SimpleMemoComponent fast path when the memo object itself has no defaultProps.
      memoType = hasWrapperDefaults ? Object.assign(memoized, { defaultProps: {} }) : memoized;
      byVariant.set(cacheKey, memoType);
    }
    return memoType;
  }

  private getLazyType(
    type: Extract<StaticElementType, { kind: "lazy" }>,
  ): ComponentType<ProxyProps> | null {
    const inner = type.inner ? this.getComponentType(type.inner) : null;
    if (!inner) return null;
    let lazyType = this.lazyTypes.get(inner);
    if (!lazyType) {
      lazyType = this.runtime.react.lazy(() => Promise.resolve({ default: inner }));
      this.lazyTypes.set(inner, lazyType);
    }
    return lazyType;
  }

  private getStubProxy(stub: StubComponent): ComponentType<ProxyProps> {
    let proxy = this.stubProxies.get(stub);
    if (!proxy) {
      const render = setFunctionName(
        ({ input }: ProxyProps): ReactNode =>
          this.renderInsideComponent(() => this.renderStub(input, stub)),
        getStubDisplayName(stub),
      );
      proxy = this.stubProxyForTag(stub.tag, render);
      this.stubProxies.set(stub, proxy);
    }
    return proxy;
  }

  private stubProxyForTag(
    tag: WorkTag | undefined,
    render: (props: ProxyProps) => ReactNode,
  ): ComponentType<ProxyProps> {
    switch (tag) {
      case ForwardRefTag:
        return this.runtime.react.forwardRef<unknown, ProxyProps>(render);
      case ClassComponentTag: {
        class StubClassProxy extends this.runtime.react.Component<ProxyProps> {
          render(): ReactNode {
            return render(this.props);
          }
        }
        return setFunctionName(StubClassProxy, render.name);
      }
      default:
        return render;
    }
  }

  private renderInsideComponent<T>(render: () => T): T {
    this.isInsideComponentRender = true;
    try {
      return render();
    } finally {
      this.isInsideComponentRender = false;
    }
  }

  private renderStub(input: ProxyInput, stub: StubComponent): ReactNode {
    const { props, location } = input;
    const context = this.renderContext(input);
    const { useState, useRef, useEffect } = this.runtime.react;
    const rendered = stub.render(
      props,
      this.stubTools(context, location, {
        useState: (initial) => useState(initial),
        useRef: (initial) => useRef(initial),
        useEffect: (effect, dependencies) => useEffect(effect, dependencies),
      }),
    );
    return this.finishRender(rendered, { ...context, depth: context.depth + 1 }, input);
  }

  private stubTools(
    context: MaterializeContext,
    location: SourceLocation | null,
    hooks: StubHooks | null = null,
  ): StubRenderTools {
    const tools: StubRenderTools = {
      readContext: (definition) =>
        providedContextValue(this.interpreter, definition, this.readContext(definition), location),
      hooks,
      callAwaited: (callee, args) => this.callAwaited(callee, args, context, location),
      call: (callee, args, thisValue) => {
        if (callee.kind === "function") {
          return this.interpreter.callFunction(callee, args, this.moduleContext(callee, context), {
            thisValue,
          });
        }
        if (callee.kind === "native-function") return callee.call(args, tools);
        return unknownValue(`call of ${describeValue(callee)}`, location);
      },
      callDeferred: (callee, args) =>
        callee.kind === "function"
          ? this.interpreter.callDeferred(
              callee,
              args,
              this.moduleContext(callee, context),
              location,
            )
          : tools.call(callee, args),
      captured: (captured, name) => this.interpreter.captured(captured, name),
      markEscaped: (value) => this.interpreter.markEscaped(value),
      queueMicrotask: (task) => this.interpreter.timers.queueMicrotask(task),
      isDeferred: () => this.interpreter.timers.isDeferred,
      setProperty: (object, key, value) => this.interpreter.assignOwnProperty(object, key, value),
      project: this.interpreter.project,
      recordStateMutation: (state) => this.interpreter.recordStateMutation(state),
      realm: this.interpreter.getRealm(context.environment),
      pushItems: (list, items) => this.interpreter.pushItems(list, items),
      setItem: (list, index, value) => this.interpreter.setItem(list, index, value),
      nameHint: null,
      templateArgumentNames: null,
      environment: context.environment,
    };
    return tools;
  }

  renderFunctionProxy(
    input: ProxyInput,
    component: ComponentDefinition,
    renderArguments: (props: StaticObjectValue) => StaticValue[],
  ): ReactNode {
    const { useRef, useState, useEffect, useLayoutEffect } = this.runtime.react;
    const instanceRef = useRef<ProxyInstance | null>(null);
    instanceRef.current ??= createProxyInstance(input.context, this.interpreter);
    const [, setPass] = useState(0);
    const props = applyDefaultProps(component, input.props);
    const context = this.renderContext(input);
    const { node, mount, unmount } = this.renderStateful(
      input,
      context,
      component,
      instanceRef.current,
      () => setPass((pass) => pass + 1),
      (frame) =>
        this.evaluateComposite(
          component,
          props,
          context,
          input.location,
          frame,
          (componentContext) =>
            this.interpreter.callFunction(
              toFunctionValue(component),
              renderArguments(props),
              componentContext,
              { awaited: true },
            ),
        ),
    );
    useLayoutEffect(() => {
      this.beginLayoutPhase();
      this.commitSuspenseScope(input.context.suspenseScope);
      mount(true);
      return () => unmount(true);
    });
    useEffect(() => {
      this.beginPassivePhase();
      mount(false);
      return () => unmount(false);
    });
    return node;
  }

  private beginLayoutPhase(): void {
    if (this.isPassivePhasePending) return;
    this.isPassivePhasePending = true;
    this.isSyncCommit = this.isSyncRenderScheduled;
    this.isSyncRenderScheduled = false;
  }

  /**
   * Passive effects run in a later task unless the commit was synchronous or
   * its layout phase scheduled synchronous work (`flushSyncWorkOnAllRoots` at
   * the end of `commitRoot` flushes them first); only in the later task have
   * the microtasks queued while rendering, committing and running layout
   * effects landed.
   */
  private beginPassivePhase(): void {
    if (!this.isPassivePhasePending) return;
    this.isPassivePhasePending = false;
    if (this.isSyncCommit || this.isSyncRenderScheduled) return;
    this.interpreter.timers.drainMicrotasks();
  }

  /**
   * One React render of a stateful proxy: the interpreter evaluates the
   * component against the instance's hook frame, the host mounts and unmounts
   * the static effects when React does the same to the proxy's own, and state
   * updates queued outside the render are committed after the current React
   * commit, as the real hooks would.
   */
  private renderStateful(
    input: ProxyInput,
    context: MaterializeContext,
    component: ComponentDefinition,
    instance: ProxyInstance,
    rerender: () => void,
    evaluate: (frame: HookFrame) => CompositeEvaluation,
  ): StatefulRender {
    const { frame } = instance;
    const changedCells = commitHookPass(frame);
    const previous = instance.rendered;
    if (
      changedCells.length === 0 &&
      previous &&
      isRetainedInput(previous.input, input) &&
      previous.context.ignoresMaybeThrows === context.ignoresMaybeThrows &&
      previous.contextReads.every((read) => this.readContext(read.definition) === read.value)
    ) {
      return this.commitRender(instance, previous, input.location);
    }
    if (changedCells.length > 0) {
      instance.passCount++;
      if (instance.passCount >= MAX_RENDER_PASSES) {
        this.interpreter.report(
          "unsettled-state",
          `${describeComponent(component)} state did not settle after ${MAX_RENDER_PASSES} render passes: ${changedCells
            .map((cell) => `${cell.name} = ${describeValue(cell.current)}`)
            .join(", ")}`,
          input.location,
          "warning",
        );
        giveUpOnHookPass(frame, changedCells);
      }
    }
    const contextReads: ContextRead[] = [];
    const evaluatePass = (): CompositeEvaluation => {
      beginHookPass(frame);
      contextReads.length = 0;
      this.contextReads = contextReads;
      try {
        return evaluate(frame);
      } finally {
        this.contextReads = null;
      }
    };
    let evaluation = evaluatePass();
    for (
      let renderPhaseUpdates = 0;
      renderPhaseUpdates < MAX_RENDER_PHASE_UPDATES && commitHookPass(frame).length > 0;
      renderPhaseUpdates++
    ) {
      evaluation = evaluatePass();
    }
    frame.isRendering = false;
    // The update reaches React at once, which picks its lane from the phase that
    // raised it: synchronous from the layout phase, default otherwise. Like
    // `nestedUpdateCount`, only chains of such updates count toward the limit,
    // so a timer task starts a new one.
    frame.requestRender = () => {
      if (frame.isFrozen) return;
      this.interpreter.mutations.record(0);
      if (this.interpreter.timers.isFlushing) instance.passCount = 0;
      if (this.isPassivePhasePending) this.isSyncRenderScheduled = true;
      rerender();
    };
    const node = this.finishRender(evaluation.rendered, evaluation.childContext, input);
    instance.rendered = {
      input,
      context,
      node,
      contextReads,
      componentContext: evaluation.componentContext,
    };
    return this.commitRender(instance, instance.rendered, input.location);
  }

  /**
   * The proxy's own effects drive the static ones: after a render they commit
   * the changed static effects; a bailout (`bailoutHooks`) keeps the previous
   * ones untouched.
   */
  private commitRender(
    instance: ProxyInstance,
    rendered: CommittedRender,
    location: SourceLocation | null,
  ): StatefulRender {
    const { frame } = instance;
    const isBailout = rendered === instance.committed;
    instance.isRenderedSinceCommit = true;
    const withEffectCall = (run: (call: EffectCall) => void): void => {
      const { componentContext } = rendered;
      if (!componentContext) return;
      run((callback) => this.interpreter.callValue(callback, [], componentContext, location));
    };
    const mount = (isLayout: boolean): void => {
      instance.committed = rendered;
      withEffectCall((call) => {
        if (!instance.isRenderedSinceCommit) mountAllEffects(frame, isLayout, call);
        else if (!isBailout) runChangedEffects(frame, isLayout, call);
        if (isLayout) return;
        commitEffects(frame);
        instance.isRenderedSinceCommit = false;
      });
    };
    const unmount = (isLayout: boolean): void =>
      withEffectCall((call) => {
        if (instance.isRenderedSinceCommit) return;
        if (isLayout) unmountClassInstance(frame, call);
        unmountAllEffects(frame, isLayout, call);
      });
    return { node: rendered.node, mount, unmount };
  }

  renderClassProxy(
    input: ProxyInput,
    component: ComponentDefinition,
    classValue: StaticClassValue,
    caught: StaticThrowError | null,
    host: ClassProxyHost,
  ): ReactNode {
    const props = applyDefaultProps(component, input.props);
    const isBoundary = isErrorBoundaryClass(classValue);
    const renderContext = this.renderContext(input);
    const context: MaterializeContext = isBoundary
      ? { ...renderContext, errorBoundaryDepth: renderContext.errorBoundaryDepth + 1 }
      : renderContext;
    const renderBoundary = (
      caughtError: boolean,
      boundaryContext: MaterializeContext,
    ): ReactNode => {
      const path: BoundaryRenderPath = caughtError
        ? "caught"
        : boundaryContext.ignoresMaybeThrows
          ? "ignoring-maybe-throws"
          : "rendered";
      const { node, mount, unmount } = this.renderStateful(
        input,
        boundaryContext,
        component,
        host.getInstance(path),
        host.rerender,
        (frame) =>
          this.evaluateComposite(
            component,
            props,
            boundaryContext,
            input.location,
            frame,
            (componentContext, childContext) => {
              const classRender = renderClassComponent(
                this.interpreter,
                classValue,
                props,
                boundaryContext.legacyContext,
                componentContext,
                caughtError,
              );
              childContext.legacyContext = classRender.childLegacyContext;
              return classRender.rendered;
            },
          ),
      );
      host.queueCommitWork({ mount, unmount });
      return node;
    };
    if (caught?.isMaybe) {
      return this.branchNode(
        context,
        [
          (alternativeContext) =>
            renderBoundary(false, { ...alternativeContext, ignoresMaybeThrows: true }),
          (alternativeContext) => renderBoundary(true, alternativeContext),
        ],
        "a child may throw into this error boundary",
        0,
        "top",
      );
    }
    return renderBoundary(caught !== null, context);
  }

  /** Places a component's rendered value, throwing to React when the static render throws. */
  private finishRender(
    rendered: StaticValue,
    childContext: MaterializeContext,
    input: ProxyInput,
  ): ReactNode {
    const certainty = getThrowCertainty(rendered);
    if (certainty === "always") {
      throw (
        this.getWakeable(rendered, input.context) ??
        new StaticThrowError(describeThrow(rendered), false)
      );
    }
    if (certainty === "maybe") {
      if (input.context.errorBoundaryDepth > 0 && !input.context.ignoresMaybeThrows) {
        throw new StaticThrowError(`component may throw: ${describeThrow(rendered)}`, true);
      }
      return this.toNode(withoutThrows(rendered), childContext, "top");
    }
    return this.toNode(rendered, childContext, "top");
  }

  /**
   * A thrown promise suspends the component; React retries it once the promise
   * settles (a wakeable in `ReactFiberThrow`). One that escaped may settle any
   * time before the snapshot, so it wakes in the next timer round, after the
   * code that escaped with it.
   */
  private getWakeable(rendered: StaticValue, context: MaterializeContext): Promise<void> | null {
    const thrown = findThrown(rendered)?.thrown;
    const promise = thrown && getModeledPromise(thrown);
    if (!promise) return null;
    this.markMaySuspend(context);
    let wakeable = this.wakeables.get(promise);
    if (!wakeable) {
      const { timers } = this.interpreter;
      wakeable = new Promise((wake) => {
        onPromiseSettled(
          promise,
          (isEscaped) => (isEscaped ? timers.enqueue(() => wake()) : wake()),
          (task) => timers.queueMicrotask(task),
        );
      });
      this.wakeables.set(promise, wakeable);
    }
    return wakeable;
  }

  private evaluateComposite(
    component: ComponentDefinition,
    props: StaticValue,
    context: MaterializeContext,
    location: SourceLocation | null,
    hooks: HookFrame | null,
    render: (componentContext: EvaluationContext, childContext: MaterializeContext) => StaticValue,
  ): CompositeEvaluation {
    const environment = this.componentEnvironment(component, context);
    const childContext: MaterializeContext = {
      ...context,
      depth: context.depth + 1,
      componentStack: [
        ...context.componentStack,
        { node: component.node, scope: component.scope, props },
      ],
      environment,
      owner: null,
    };
    if (context.depth >= this.maxComponentDepth) {
      this.interpreter.report(
        "max-component-depth",
        `component depth ${this.maxComponentDepth} exceeded at ${describeComponent(component)}`,
        location,
        "warning",
      );
      return {
        rendered: unknownValue("component depth exceeded", location),
        childContext,
        componentContext: null,
      };
    }
    const ancestors = context.componentStack.filter((frame) => frame.node === component.node);
    const isNonTerminating = ancestors.some(
      (frame) => frame.scope === component.scope && areValuesEquivalent(frame.props, props),
    );
    if (isNonTerminating || ancestors.length >= this.maxRecursionPerComponent) {
      this.interpreter.report(
        "max-recursion",
        isNonTerminating
          ? `recursive render of ${describeComponent(component)} with equivalent props truncated`
          : `recursive render of ${describeComponent(component)} truncated after ${ancestors.length} levels`,
        location,
        "warning",
      );
      return {
        rendered: unknownValue(`recursive ${describeComponent(component)}`, location),
        childContext,
        componentContext: null,
      };
    }
    const componentContext: EvaluationContext = {
      ...this.interpreter.createModuleContext(component.module, this.readContext, environment),
      hooks,
    };
    childContext.owner = componentContext;
    return { rendered: render(componentContext, childContext), childContext, componentContext };
  }

  /** Under RSC an element created outside a client boundary (a module with `"use client"`) is Flight's to render. */
  private isServerEnvironment(element: StaticElementValue, context: MaterializeContext): boolean {
    return this.serverComponents && (element.environment ?? context.environment) !== "client";
  }

  private componentEnvironment(
    component: ComponentDefinition,
    context: MaterializeContext,
  ): RenderEnvironment | null {
    if (!this.serverComponents) return null;
    if (context.environment === "client" || isClientComponent(component)) return "client";
    return isClassNode(component.node) ? "client" : "server";
  }

  private moduleContext(
    callee: StaticFunctionValue,
    context: MaterializeContext,
  ): EvaluationContext {
    return this.interpreter.createModuleContext(
      callee.module,
      this.readContext,
      context.environment,
    );
  }

  private callAwaited(
    callee: StaticValue,
    args: StaticValue[],
    context: MaterializeContext,
    location: SourceLocation | null,
  ): StaticValue {
    if (callee.kind !== "function") {
      return unknownValue(`call of ${describeValue(callee)}`, location);
    }
    return this.interpreter.callAwaited(
      callee,
      args,
      this.moduleContext(callee, context),
      location,
    );
  }

  /**
   * A Suspense boundary whose primary subtree can still be suspended once the
   * page has settled (external or unknown content; a resolved `lazy` has loaded
   * by then) is observed either showing its content or its fallback; the second
   * alternative really suspends so React lays out the hidden primary tree and
   * the fallback itself.
   */
  renderSuspenseBoundary(input: ProxyInput): ReactNode {
    const { useRef, useState, useLayoutEffect, createElement, Suspense } = this.runtime.react;
    const scopeRef = useRef<SuspenseScope | null>(null);
    scopeRef.current ??= { maySuspend: false, commit: noop };
    const scope = scopeRef.current;
    const [isSuspendable, setSuspendable] = useState(false);
    scope.commit = () => {
      if (!isSuspendable) setSuspendable(true);
    };
    useLayoutEffect(() => this.commitSuspenseScope(scope));
    const { props } = input;
    const context = this.renderContext(input);
    const fallback = this.toNode(getObjectProperty(props, "fallback"), context, "top");
    const primary = this.toNode(
      getObjectProperty(props, "children"),
      { ...context, suspenseScope: scope },
      "top",
    );
    const content = createElement(Suspense, { fallback }, primary);
    if (!isSuspendable) return content;
    return this.branchNode(
      context,
      [
        () => content,
        () => createElement(Suspense, { fallback }, createElement(this.suspendedMarker)),
      ],
      "Suspense boundary may be suspended when observed",
      0,
      "top",
      null,
      null,
      true,
    );
  }
}
