import type { Class } from "oxc-parser";
import type { ComponentClass, ComponentType, Context, ExoticComponent, ReactNode } from "react";
import { isErrorBoundaryClass, renderClassComponent } from "../evaluate/class-component.js";
import type { ContextReader, EvaluationContext } from "../evaluate/context.js";
import { providedContextValue } from "../evaluate/react-calls.js";
import {
  beginHookPass,
  commitHookPass,
  createHookFrame,
  effectsToRun,
  giveUpOnHookPass,
  restartHookPass,
  type HookFrame,
} from "../evaluate/hooks.js";
import type { Interpreter } from "../evaluate/interpreter.js";
import {
  areValuesEquivalent,
  describeValue,
  getObjectProperty,
  mapValue,
  NULL_VALUE,
  omitObjectKeys,
  unknownValue,
} from "../evaluate/values.js";
import type {
  ComponentDefinition,
  ContextDefinition,
  ModuleRecord,
  RenderEnvironment,
  Scope,
  SourceLocation,
  StaticClassValue,
  StaticElementType,
  StaticElementValue,
  StaticFunctionValue,
  StaticHostNodeValue,
  StaticObjectValue,
  StaticUnknownValue,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";
import { ForwardRefTag } from "../work-tags.js";
import {
  AlternativeMarker,
  BranchMarker,
  MARKER_NAMES,
  OpaqueMarker,
  RepeatMarker,
  SuspendedMarker,
  TEXT_PLACEHOLDER,
  TextMarker,
  UnknownMarker,
} from "./markers.js";
import type { ReactRuntime } from "./react-runtime.js";

const DEFAULT_MAX_COMPONENT_DEPTH = 512;
const DEFAULT_MAX_ELEMENT_COUNT = 50_000;
const DEFAULT_MAX_RECURSION_PER_COMPONENT = 16;
const MAX_RENDER_PASSES = 8;
const MAX_RENDER_PHASE_UPDATES = 25;
// Every alternative of a branch is materialized, so nested branches multiply the
// work; deviations from the preferred path deeper than this become wildcards.
const MAX_ALTERNATIVE_DEPTH = 2;
const USE_CLIENT_DIRECTIVE = "use client";

/** Tags whose `children` React DOM either rejects (void elements) or never reconciles (`textarea`, `noscript`). */
const CHILDLESS_HOST_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "menuitem",
  "meta",
  "noscript",
  "param",
  "source",
  "textarea",
  "track",
  "wbr",
]);

export interface MaterializerOptions {
  maxComponentDepth?: number;
  maxFiberCount?: number;
  maxRecursionPerComponent?: number;
  serverComponents?: boolean;
}

/** Mutable per-Suspense-boundary record; set when something in the primary subtree can suspend. */
export interface SuspenseScope {
  maySuspend: boolean;
}

export interface CompositeFrame {
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
export interface MaterializeContext {
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
}

/** The static element a proxy component stands for, handed to it as its only prop. */
export interface ProxyInput {
  props: StaticObjectValue;
  ref: StaticValue | null;
  location: SourceLocation | null;
  context: MaterializeContext;
}

export interface ProxyProps {
  input: ProxyInput;
}

interface ErrorBoundaryState {
  caught: StaticThrowError | null;
}

/** Per-instance bookkeeping a proxy keeps across React renders. */
interface ProxyInstance {
  frame: HookFrame;
  passCount: number;
  isCommitScheduled: boolean;
}

interface StatefulRender {
  node: ReactNode;
  runEffects: (isLayout: boolean) => void;
}

/** How a class proxy instance hands its persistent state and commit hooks to the materializer. */
interface ClassProxyHost {
  getInstance: (caughtError: boolean) => ProxyInstance;
  rerender: () => void;
  queueCommitWork: (work: () => void) => void;
}

const createProxyInstance = (): ProxyInstance => ({
  frame: createHookFrame(),
  passCount: 0,
  isCommitScheduled: false,
});

interface CompositeEvaluation {
  rendered: StaticValue;
  childContext: MaterializeContext;
  componentContext: EvaluationContext | null;
}

interface MaterializedElement {
  context: MaterializeContext;
  isTopLevel: boolean;
  node: ReactNode;
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
  first.componentStack.length === second.componentStack.length &&
  first.componentStack.every((frame, index) => isSameFrame(frame, second.componentStack[index]));

/** Thrown by a proxy whose static render evaluates to a thrown value, so React's error boundaries take over. */
export class StaticThrowError extends Error {
  readonly isMaybe: boolean;

  constructor(reason: string, isMaybe: boolean) {
    super(reason);
    this.name = "StaticThrowError";
    this.isMaybe = isMaybe;
  }
}

type ThrowCertainty = "never" | "maybe" | "always";

const combineSiblings = (left: ThrowCertainty, right: ThrowCertainty): ThrowCertainty =>
  left === "always" || right === "always"
    ? "always"
    : left === "maybe" || right === "maybe"
      ? "maybe"
      : "never";

/** Whether placing `value` as children throws; elements throw from their own proxies. */
const getThrowCertainty = (value: StaticValue): ThrowCertainty => {
  switch (value.kind) {
    case "unknown":
      return value.isThrown ? "always" : "never";
    case "list":
      return value.items.map(getThrowCertainty).reduce(combineSiblings, "never");
    case "branch": {
      const outcomes = value.alternatives.map(getThrowCertainty);
      if (outcomes.every((outcome) => outcome === "always")) return "always";
      return outcomes.every((outcome) => outcome === "never") ? "never" : "maybe";
    }
    case "optional":
    case "repeat":
      return getThrowCertainty(value.kind === "optional" ? value.value : value.item) === "never"
        ? "never"
        : "maybe";
    default:
      return "never";
  }
};

const findThrown = (value: StaticValue): StaticUnknownValue | null => {
  switch (value.kind) {
    case "unknown":
      return value.isThrown ? value : null;
    case "list":
      return value.items.map(findThrown).find((thrown) => thrown !== null) ?? null;
    case "branch":
      return value.alternatives.map(findThrown).find((thrown) => thrown !== null) ?? null;
    default:
      return null;
  }
};

const describeThrow = (value: StaticValue): string => {
  const thrown = findThrown(value);
  if (!thrown) return "component throws";
  const where = thrown.location ? ` at ${thrown.location.filePath}:${thrown.location.line}` : "";
  return `${thrown.reason}${where}`;
};

const withoutThrows = (value: StaticValue): StaticValue => {
  switch (value.kind) {
    case "unknown":
      return value.isThrown ? unknownValue("thrown render", value.location) : value;
    case "list":
      return { ...value, items: value.items.map(withoutThrows) };
    case "branch": {
      const alternatives = value.alternatives
        .filter((alternative) => getThrowCertainty(alternative) !== "always")
        .map(withoutThrows);
      return alternatives.length === 1 ? alternatives[0] : { ...value, alternatives };
    }
    case "optional":
      return { ...value, value: withoutThrows(value.value) };
    case "repeat":
      return { ...value, item: withoutThrows(value.item) };
    default:
      return value;
  }
};

const isClientModule = (module: ModuleRecord): boolean =>
  module.directives.includes(USE_CLIENT_DIRECTIVE);

const isClassNode = (node: ComponentDefinition["node"]): node is Class =>
  node.type === "ClassDeclaration" || node.type === "ClassExpression";

/**
 * A component's React identity is its closure: the same function node evaluated
 * in two scopes (e.g. a HOC applied twice) yields two distinct component types.
 */
class ComponentCache<T> {
  private readonly byNode = new WeakMap<ComponentDefinition["node"], WeakMap<Scope, T>>();

  get(component: ComponentDefinition): T | undefined {
    return this.byNode.get(component.node)?.get(component.scope);
  }

  set(component: ComponentDefinition, value: T): void {
    let byScope = this.byNode.get(component.node);
    if (!byScope) {
      byScope = new WeakMap();
      this.byNode.set(component.node, byScope);
    }
    byScope.set(component.scope, value);
  }
}

const describeComponent = (component: ComponentDefinition): string =>
  component.name ?? "anonymous component";

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
  const displayName = component.properties.get("displayName");
  if (displayName?.kind === "primitive" && typeof displayName.value === "string")
    return displayName.value;
  return component.name;
};

const hasDefaultProps = (component: ComponentDefinition): boolean => {
  const defaults = component.properties.get("defaultProps");
  return defaults !== undefined && isNonNullish(defaults);
};

const applyDefaultProps = (
  component: ComponentDefinition,
  props: StaticObjectValue,
): StaticObjectValue => {
  const defaults = component.properties.get("defaultProps");
  if (!defaults || !isNonNullish(defaults)) return props;
  return { kind: "object", entries: [{ kind: "spread", value: defaults }, ...props.entries] };
};

const toFunctionValue = (component: ComponentDefinition): StaticFunctionValue => {
  const node = component.node;
  if (isClassNode(node)) throw new Error(`${describeComponent(component)} is a class component`);
  return {
    kind: "function",
    node,
    scope: component.scope,
    module: component.module,
    thisValue: null,
    superBinding: null,
    name: component.name,
    properties: component.properties,
  };
};

const toClassValue = (component: ComponentDefinition): StaticClassValue => {
  if (!component.classBody) {
    throw new Error(`${describeComponent(component)} is not a class component`);
  }
  return {
    kind: "class",
    node: component.node,
    body: component.classBody,
    scope: component.scope,
    module: component.module,
    name: component.name,
    properties: component.properties,
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
  private materializedCount = 0;
  private readonly maxComponentDepth: number;
  private readonly maxElementCount: number;
  private readonly maxRecursionPerComponent: number;
  private readonly serverComponents: boolean;
  private isBudgetExhausted = false;
  private readonly functionProxies = new ComponentCache<ComponentType<ProxyProps>>();
  private readonly classProxies = new ComponentCache<ComponentClass<ProxyProps>>();
  private readonly forwardRefProxies = new ComponentCache<Map<string, ComponentType<ProxyProps>>>();
  private readonly memoTypes = new WeakMap<object, Map<string, ComponentType<ProxyProps>>>();
  private readonly lazyTypes = new WeakMap<object, ComponentType<ProxyProps>>();
  private readonly contexts = new WeakMap<
    ContextDefinition | StaticElementType,
    Context<StaticValue | null>
  >();
  private isInsideComponentRender = false;
  /** `use` reads a context from any render (class bodies, Consumer render props included); older Reacts only have `useContext`. */
  private readonly useStaticContext: (context: Context<StaticValue | null>) => StaticValue | null;
  /** Context values flow through React itself, so a proxy reads them at its own fiber, as the real hook would. */
  private readonly readContext: ContextReader = (definition) =>
    this.isInsideComponentRender ? this.useStaticContext(this.getContext(definition)) : null;
  private readonly stubProxies = new WeakMap<StubComponent, ComponentType<ProxyProps>>();
  private readonly suspenseBoundaryProxy: ComponentType<ProxyProps>;
  private portalContainer: Element | null = null;
  private readonly hostNodes = new WeakMap<Element, StaticHostNodeValue>();
  private readonly materializedElements = new WeakMap<StaticElementValue, MaterializedElement[]>();

  constructor(interpreter: Interpreter, runtime: ReactRuntime, options: MaterializerOptions = {}) {
    this.interpreter = interpreter;
    this.runtime = runtime;
    this.maxComponentDepth = options.maxComponentDepth ?? DEFAULT_MAX_COMPONENT_DEPTH;
    this.maxElementCount = options.maxFiberCount ?? DEFAULT_MAX_ELEMENT_COUNT;
    this.maxRecursionPerComponent =
      options.maxRecursionPerComponent ?? DEFAULT_MAX_RECURSION_PER_COMPONENT;
    this.serverComponents = options.serverComponents ?? false;
    this.useStaticContext = runtime.react.use ?? runtime.react.useContext;
    this.suspenseBoundaryProxy = setFunctionName(
      ({ input }: ProxyProps): ReactNode => this.renderSuspenseBoundary(input),
      MARKER_NAMES.suspenseBoundary,
    );
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
    };
  }

  /** The React element tree for a root value, as `root.render(...)` would receive it. */
  toRootNode(value: StaticValue): ReactNode {
    return this.toNode(value, this.createRootContext(), true);
  }

  /**
   * Materializes one child position. `isTopLevel` is React's own distinction
   * in `reconcileChildFibers`: arrays at the top level are the children list,
   * nested arrays become implicit Fragments.
   */
  toNode(value: StaticValue, context: MaterializeContext, isTopLevel: boolean): ReactNode {
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
        return this.elementToNode(value, context, isTopLevel);
      case "list":
        return value.items.map((item) => this.toNode(item, context, false));
      case "repeat":
        return this.runtime.react.createElement(RepeatMarker, {
          children: [this.toNode(value.item, context, false)],
        });
      case "branch":
        return this.branchNode(
          value.alternatives.map((alternative, index) =>
            this.alternativeNode(alternative, index === value.preferredIndex, context, isTopLevel),
          ),
          value.reason,
          value.preferredIndex,
          isTopLevel,
        );
      case "optional":
        return this.branchNode(
          [this.toNode(value.value, context, isTopLevel), null],
          value.reason,
          0,
          isTopLevel,
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
    isTopLevel: boolean,
  ): ReactNode {
    if (isPreferred) return this.toNode(value, context, isTopLevel);
    if (context.alternativeDepth >= MAX_ALTERNATIVE_DEPTH) {
      return this.unknownNode(
        `alternative nested ${MAX_ALTERNATIVE_DEPTH} branches away from the preferred path`,
      );
    }
    return this.toNode(
      value,
      { ...context, alternativeDepth: context.alternativeDepth + 1 },
      isTopLevel,
    );
  }

  private branchNode(
    alternatives: ReactNode[],
    reason: string,
    preferredIndex: number | null,
    isTopLevel: boolean,
  ): ReactNode {
    const { createElement } = this.runtime.react;
    return createElement(BranchMarker, {
      reason,
      preferredIndex,
      children: alternatives.map((node, index) =>
        createElement(AlternativeMarker, { key: index, children: isTopLevel ? node : [node] }),
      ),
    });
  }

  private unknownNode(reason: string): ReactNode {
    return this.runtime.react.createElement(UnknownMarker, { reason });
  }

  /** An element whose component is not known may suspend (a `use()` or lazy inside it). */
  private unknownElementNode(reason: string, context: MaterializeContext): ReactNode {
    this.markMaySuspend(context);
    return this.unknownNode(reason);
  }

  private markMaySuspend(context: MaterializeContext): void {
    if (context.suspenseScope) context.suspenseScope.maySuspend = true;
  }

  /**
   * React bails a child out of re-rendering only when it receives the very same
   * element object, so a static element materialized again at the same
   * position must yield the element it produced before.
   */
  private elementToNode(
    element: StaticElementValue,
    context: MaterializeContext,
    isTopLevel: boolean,
  ): ReactNode {
    let materialized = this.materializedElements.get(element);
    if (!materialized) {
      materialized = [];
      this.materializedElements.set(element, materialized);
    }
    const previous = materialized.find(
      (candidate) =>
        candidate.isTopLevel === isTopLevel && isSamePosition(candidate.context, context),
    );
    if (previous) return previous.node;
    const node = this.freshElementToNode(element, context, isTopLevel);
    materialized.push({ context, isTopLevel, node });
    return node;
  }

  private freshElementToNode(
    element: StaticElementValue,
    context: MaterializeContext,
    isTopLevel: boolean,
  ): ReactNode {
    if (element.type.kind === "function" && this.isServerComponentElement(element, context)) {
      const component = element.type.component;
      const server = this.evaluateComposite(
        component,
        element.props,
        { ...context, environment: element.environment ?? context.environment },
        element.location,
        null,
        (componentContext) =>
          this.interpreter.callFunction(
            toFunctionValue(component),
            [element.props],
            componentContext,
          ),
      );
      return this.toNode(server.rendered, server.childContext, isTopLevel);
    }
    return this.createNode(element.type, element.key, element.props, element.location, context);
  }

  private createNode(
    type: StaticElementType,
    key: StaticValue | null,
    props: StaticObjectValue,
    location: SourceLocation | null,
    context: MaterializeContext,
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
      return this.unknownNode("element budget exhausted");
    }
    const reactKey = this.keyToString(key, location);
    const children = getObjectProperty(props, "children");
    const input: ProxyInput = { props, ref: null, location, context };
    switch (type.kind) {
      case "host":
        return createElement(
          type.tagName,
          this.hostProps(type.tagName, props, reactKey, location, context),
        );
      case "function":
        return createElement(this.getFunctionProxy(type.component), { key: reactKey, input });
      case "class":
        return createElement(this.getClassProxy(type.component), { key: reactKey, input });
      case "memo": {
        const memoType = this.getMemoType(type);
        if (!memoType)
          return this.unknownElementNode(`memo of ${type.inner.kind} element type`, context);
        return createElement(memoType, { key: reactKey, input });
      }
      case "forward-ref": {
        const ref = getObjectProperty(props, "ref");
        const renderProps = omitObjectKeys(props, new Set(["ref"]));
        return createElement(this.getForwardRefProxy(type), {
          key: reactKey,
          input: {
            ...input,
            props: renderProps.kind === "object" ? renderProps : props,
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
        return createElement(lazyType, { key: reactKey, input });
      }
      case "fragment":
        return createElement(
          this.runtime.react.Fragment,
          { key: reactKey },
          this.toNode(children, context, true),
        );
      case "strict-mode":
        return createElement(
          this.runtime.react.StrictMode,
          { key: reactKey },
          this.toNode(children, context, true),
        );
      case "profiler": {
        const id = this.toAttribute("id", getObjectProperty(props, "id"), context);
        return createElement(
          this.runtime.react.Profiler,
          { key: reactKey, id: typeof id === "string" ? id : "", onRender: noop },
          this.toNode(children, context, true),
        );
      }
      case "suspense":
        return createElement(this.suspenseBoundaryProxy, { key: reactKey, input });
      case "suspense-list":
      case "activity":
      case "view-transition": {
        const exotic = this.getExoticType(type.kind);
        if (!exotic) {
          return this.unknownNode(`${type.kind} is not available in React ${this.runtime.version}`);
        }
        return createElement(exotic, { key: reactKey }, this.toNode(children, context, true));
      }
      case "context-provider": {
        const realContext = this.getContext(type.context ?? type);
        this.noteUnresolvedContext(type.context, location);
        return createElement(
          realContext.Provider,
          { key: reactKey, value: type.context ? getObjectProperty(props, "value") : null },
          this.toNode(children, context, true),
        );
      }
      case "context-consumer": {
        const realContext = this.getContext(type.context ?? type);
        this.noteUnresolvedContext(type.context, location);
        return createElement(realContext.Consumer, {
          key: reactKey,
          children: (provided) =>
            this.renderConsumer(type.context, provided, children, context, location),
        });
      }
      case "portal":
        return this.runtime.dom.createPortal(
          this.toNode(children, context, true),
          this.getPortalContainer(),
          reactKey ?? null,
        );
      case "external": {
        this.markMaySuspend(context);
        this.interpreter.markEscaped(props);
        return createElement(OpaqueMarker, {
          key: reactKey,
          displayName: type.displayName,
          importedName: type.importedName,
          packageName: type.packageName,
          reason: `${type.importedName} from ${type.packageName} is not analyzed`,
          children: this.toNode(children, context, true),
        });
      }
      case "stub":
        return createElement(this.getStubProxy(type.stub), { key: reactKey, input });
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
    if (children.kind !== "function") {
      return this.unknownElementNode("Consumer render prop is dynamic", context);
    }
    const contextValue = definition
      ? providedContextValue(this.interpreter, definition, provided, location)
      : unknownValue("context value from an unresolved context");
    const evaluationContext = this.interpreter.createModuleContext(children.module, (candidate) =>
      candidate === definition ? provided : null,
    );
    return this.toNode(
      this.interpreter.callFunction(children, [contextValue], evaluationContext),
      context,
      true,
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
    if (CHILDLESS_HOST_TAGS.has(tagName)) return result;
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
        return this.toNode(value, context, false);
      case "branch": {
        const preferred = value.alternatives[value.preferredIndex ?? 0] ?? value.alternatives[0];
        return preferred ? this.toAttribute(key, preferred, context) : undefined;
      }
      case "optional":
        return this.toAttribute(key, value.value, context);
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
    return this.toNode(textContentToNull(children), context, true);
  }

  private keyToString(
    key: StaticValue | null,
    location: SourceLocation | null,
  ): string | undefined {
    if (!key) return undefined;
    if (key.kind === "primitive") {
      if (key.value === null || key.value === undefined) return undefined;
      return String(key.value);
    }
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

  private hostRef(
    ref: StaticValue,
    location: SourceLocation | null,
    context: MaterializeContext,
  ): ((node: Element | null) => void) | undefined {
    const owner = context.owner;
    if (!owner || !isNonNullish(ref)) return undefined;
    return (node) => {
      this.interpreter.assignRef(
        ref,
        node ? this.hostNodeValue(node) : NULL_VALUE,
        owner,
        location,
      );
    };
  }

  private hostNodeValue(node: Element): StaticHostNodeValue {
    let value = this.hostNodes.get(node);
    if (!value) {
      value = { kind: "host-node", tagName: node.tagName.toLowerCase() };
      this.hostNodes.set(node, value);
    }
    return value;
  }

  private getPortalContainer(): Element {
    this.portalContainer ??= document.createElement("div");
    return this.portalContainer;
  }

  private getFunctionProxy(component: ComponentDefinition): ComponentType<ProxyProps> {
    let proxy = this.functionProxies.get(component);
    if (!proxy) {
      const render = setFunctionName(
        ({ input }: ProxyProps): ReactNode =>
          this.renderInsideComponent(() => this.renderFunctionProxy(input, component, null)),
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
        private readonly instances = new Map<boolean, ProxyInstance>();
        private commitWork: (() => void)[] = [];
        private readonly host: ClassProxyHost = {
          getInstance: (caughtError) => {
            let instance = this.instances.get(caughtError);
            if (!instance) {
              instance = createProxyInstance();
              this.instances.set(caughtError, instance);
            }
            return instance;
          },
          rerender: () => this.forceUpdate(),
          queueCommitWork: (work) => this.commitWork.push(work),
        };

        render(): ReactNode {
          return renderProxy(this.props.input, this.state.caught, this.host);
        }

        componentDidMount(): void {
          this.flushCommitWork();
        }

        componentDidUpdate(): void {
          this.flushCommitWork();
        }

        private flushCommitWork(): void {
          const work = this.commitWork;
          this.commitWork = [];
          for (const run of work) run();
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
        isErrorBoundaryClass(classValue.body) ? ErrorBoundaryProxy : ClassProxy,
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
            this.renderInsideComponent(() => this.renderFunctionProxy(input, component, input.ref)),
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
    const cacheKey = `${type.hasCompare ? "compare" : ""}\u0000${type.displayName ?? ""}`;
    let memoType = byVariant.get(cacheKey);
    if (!memoType) {
      const memoized = this.runtime.react.memo(inner, type.hasCompare ? () => false : undefined);
      if (type.displayName) memoized.displayName = type.displayName;
      memoType = memoized;
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
        stub.displayName,
      );
      proxy =
        stub.tag === ForwardRefTag
          ? this.runtime.react.forwardRef<unknown, ProxyProps>(render)
          : render;
      this.stubProxies.set(stub, proxy);
    }
    return proxy;
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
    const { context, props, location } = input;
    const tools: StubRenderTools = {
      readContext: (definition) =>
        providedContextValue(this.interpreter, definition, this.readContext(definition), location),
      callAwaited: (callee, args) => this.callAwaited(callee, args, context, location),
      call: (callee, args) => {
        if (callee.kind === "function") {
          return this.interpreter.callFunction(callee, args, this.moduleContext(callee, context));
        }
        if (callee.kind === "native-function") return callee.call(args, tools);
        return unknownValue(`call of ${describeValue(callee)}`, location);
      },
      captured: (captured, name) => this.interpreter.captured(captured, name),
      markEscaped: (value) => this.interpreter.markEscaped(value),
      nameHint: null,
      templateArgumentNames: null,
    };
    const rendered = stub.render(props, tools);
    return this.finishRender(rendered, { ...context, depth: context.depth + 1 }, input);
  }

  renderFunctionProxy(
    input: ProxyInput,
    component: ComponentDefinition,
    secondArgument: StaticValue | null,
  ): ReactNode {
    const { useRef, useState, useEffect, useLayoutEffect } = this.runtime.react;
    const instanceRef = useRef<ProxyInstance | null>(null);
    instanceRef.current ??= createProxyInstance();
    const [, setPass] = useState(0);
    const props = applyDefaultProps(component, input.props);
    const { node, runEffects } = this.renderStateful(
      input,
      component,
      instanceRef.current,
      () => setPass((pass) => pass + 1),
      (frame) =>
        this.evaluateComposite(
          component,
          props,
          input.context,
          input.location,
          frame,
          (componentContext) =>
            this.interpreter.callFunction(
              toFunctionValue(component),
              secondArgument ? [props, secondArgument] : [props],
              componentContext,
            ),
        ),
    );
    useLayoutEffect(() => runEffects(true));
    useEffect(() => runEffects(false));
    return node;
  }

  /**
   * One React render of a stateful proxy: the interpreter evaluates the
   * component against the instance's hook frame, the host runs the static
   * effects whose deps changed after the commit, and state updates queued
   * outside the render are committed after the current React commit, as the
   * real hooks would.
   */
  private renderStateful(
    input: ProxyInput,
    component: ComponentDefinition,
    instance: ProxyInstance,
    rerender: () => void,
    evaluate: (frame: HookFrame) => CompositeEvaluation,
  ): StatefulRender {
    const { frame } = instance;
    beginHookPass(frame);
    let evaluation = evaluate(frame);
    for (
      let renderPhaseUpdates = 0;
      renderPhaseUpdates < MAX_RENDER_PHASE_UPDATES && commitHookPass(frame).length > 0;
      renderPhaseUpdates++
    ) {
      restartHookPass(frame);
      evaluation = evaluate(frame);
    }
    frame.isRendering = false;
    const runEffects = (isLayout: boolean): void => {
      if (!evaluation.componentContext) return;
      for (const effect of effectsToRun(frame)) {
        if (effect.isLayout !== isLayout) continue;
        this.interpreter.callValue(
          effect.callback,
          [],
          evaluation.componentContext,
          input.location,
        );
      }
    };
    const commitPass = (): void => {
      instance.isCommitScheduled = false;
      const changedCells = commitHookPass(frame);
      if (changedCells.length === 0) return;
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
      rerender();
    };
    // Updates from refs, effects and store listeners are flushed after the commit
    // that raised them, as `flushSyncWorkOnAllRoots` does at the end of `commitRoot`;
    // like `nestedUpdateCount`, only those chains count toward the limit, so a
    // timer task starts a new one.
    frame.requestRender = () => {
      this.interpreter.changeCount++;
      if (this.interpreter.timers.isFlushing) instance.passCount = 0;
      if (instance.isCommitScheduled) return;
      instance.isCommitScheduled = true;
      queueMicrotask(commitPass);
    };
    return {
      node: this.finishRender(evaluation.rendered, evaluation.childContext, input),
      runEffects,
    };
  }

  renderClassProxy(
    input: ProxyInput,
    component: ComponentDefinition,
    classValue: StaticClassValue,
    caught: StaticThrowError | null,
    host: ClassProxyHost,
  ): ReactNode {
    const props = applyDefaultProps(component, input.props);
    const isBoundary = isErrorBoundaryClass(classValue.body);
    const context: MaterializeContext = isBoundary
      ? { ...input.context, errorBoundaryDepth: input.context.errorBoundaryDepth + 1 }
      : input.context;
    const renderBoundary = (
      caughtError: boolean,
      boundaryContext: MaterializeContext,
    ): ReactNode => {
      const { node, runEffects } = this.renderStateful(
        input,
        component,
        host.getInstance(caughtError),
        host.rerender,
        (frame) =>
          this.evaluateComposite(
            component,
            props,
            boundaryContext,
            input.location,
            frame,
            (componentContext) =>
              renderClassComponent(
                this.interpreter,
                classValue,
                props,
                componentContext,
                caughtError,
              ),
          ),
      );
      host.queueCommitWork(() => {
        runEffects(true);
        runEffects(false);
      });
      return node;
    };
    if (caught?.isMaybe) {
      return this.branchNode(
        [
          renderBoundary(false, { ...context, ignoresMaybeThrows: true }),
          renderBoundary(true, context),
        ],
        "a child may throw into this error boundary",
        0,
        true,
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
    if (certainty === "always") throw new StaticThrowError(describeThrow(rendered), false);
    if (certainty === "maybe") {
      if (input.context.errorBoundaryDepth > 0 && !input.context.ignoresMaybeThrows) {
        throw new StaticThrowError("component may throw", true);
      }
      return this.toNode(withoutThrows(rendered), childContext, true);
    }
    return this.toNode(rendered, childContext, true);
  }

  private evaluateComposite(
    component: ComponentDefinition,
    props: StaticValue,
    context: MaterializeContext,
    location: SourceLocation | null,
    hooks: HookFrame | null,
    render: (componentContext: EvaluationContext) => StaticValue,
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
    return { rendered: render(componentContext), childContext, componentContext };
  }

  /**
   * Under RSC a function component created by server code renders on the server
   * unless its module (or the module that created the element) opted into the
   * client bundle with `"use client"`.
   */
  private isServerComponentElement(
    element: StaticElementValue,
    context: MaterializeContext,
  ): boolean {
    if (!this.serverComponents || element.type.kind !== "function") return false;
    const createdIn = element.environment ?? context.environment;
    return createdIn !== "client" && !isClientModule(element.type.component.module);
  }

  private componentEnvironment(
    component: ComponentDefinition,
    context: MaterializeContext,
  ): RenderEnvironment | null {
    if (!this.serverComponents) return null;
    if (context.environment === "client" || isClientModule(component.module)) return "client";
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
    scopeRef.current ??= { maySuspend: false };
    const scope = scopeRef.current;
    const [isSuspendable, setSuspendable] = useState(false);
    useLayoutEffect(() => {
      if (scope.maySuspend && !isSuspendable) setSuspendable(true);
    });
    const { props, context } = input;
    const fallback = this.toNode(getObjectProperty(props, "fallback"), context, true);
    const primary = this.toNode(
      getObjectProperty(props, "children"),
      { ...context, suspenseScope: scope },
      true,
    );
    const content = createElement(Suspense, { fallback }, primary);
    if (!isSuspendable) return content;
    return this.branchNode(
      [content, createElement(Suspense, { fallback }, createElement(SuspendedMarker))],
      "Suspense boundary may be suspended when observed",
      0,
      true,
    );
  }
}
