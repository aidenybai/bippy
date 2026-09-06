import type { Class } from "oxc-parser";
import type { ContextFrame } from "../evaluate/context.js";
import { renderClassComponent } from "../evaluate/class-component.js";
import type { Interpreter } from "../evaluate/interpreter.js";
import {
  describeElementType,
  describeValue,
  getObjectProperty,
  omitObjectKeys,
  unknownValue,
} from "../evaluate/values.js";
import type {
  ComponentDefinition,
  ContextDefinition,
  SourceLocation,
  StaticElementFiber,
  StaticElementType,
  StaticElementValue,
  StaticFiber,
  StaticFunctionValue,
  StaticObjectValue,
  StaticRenderStats,
  StaticValue,
  StaticClassValue,
} from "../types.js";
import {
  ActivityComponentTag,
  ClassComponentTag,
  ContextConsumerTag,
  ContextProviderTag,
  ForwardRefTag,
  FragmentTag,
  FunctionComponentTag,
  HostComponentTag,
  HostHoistableTag,
  HostPortalTag,
  HostRootTag,
  HostSingletonTag,
  HostTextTag,
  LazyComponentTag,
  MemoComponentTag,
  ModeTag,
  OffscreenComponentTag,
  ProfilerTag,
  SimpleMemoComponentTag,
  SuspenseComponentTag,
  SuspenseListComponentTag,
  ViewTransitionComponentTag,
  type WorkTag,
} from "../work-tags.js";
import {
  applyDefaultProps,
  getElementDisplayName,
  hasDefaultProps,
  isHostHoistable,
  isHostSingleton,
  shouldSetTextContent,
} from "./host-semantics.js";

export interface FiberBuilderOptions {
  maxComponentDepth?: number;
  maxFiberCount?: number;
  maxRecursionPerComponent?: number;
  supportsSingletons?: boolean;
}

const DEFAULT_MAX_COMPONENT_DEPTH = 64;
const DEFAULT_MAX_FIBER_COUNT = 50_000;
const DEFAULT_MAX_RECURSION_PER_COMPONENT = 3;

/** Mutable per-Suspense-boundary record; set when something in the primary subtree can suspend. */
interface SuspenseScope {
  maySuspend: boolean;
}

interface BuildContext {
  depth: number;
  contextFrame: ContextFrame | null;
  componentStack: ComponentDefinition["node"][];
  suspenseScope: SuspenseScope | null;
}

const isClassNode = (node: ComponentDefinition["node"]): node is Class =>
  node.type === "ClassDeclaration" || node.type === "ClassExpression";

const describeComponent = (component: ComponentDefinition): string =>
  component.name ?? "anonymous component";

const isSkippedChild = (value: StaticValue): boolean =>
  (value.kind === "primitive" &&
    (value.value === null ||
      value.value === undefined ||
      typeof value.value === "boolean" ||
      value.value === "")) ||
  (value.kind === "unknown-primitive" && value.primitiveType === "boolean");

export class FiberBuilder {
  readonly stats: StaticRenderStats = {
    fiberCount: 0,
    textCount: 0,
    branchCount: 0,
    repeatCount: 0,
    opaqueCount: 0,
    unknownCount: 0,
    modulesLoaded: 0,
  };
  private nextId = 1;
  private readonly interpreter: Interpreter;
  private readonly maxComponentDepth: number;
  private readonly maxFiberCount: number;
  private readonly maxRecursionPerComponent: number;
  private readonly supportsSingletons: boolean;
  private budgetExhausted = false;

  constructor(interpreter: Interpreter, options: FiberBuilderOptions = {}) {
    this.interpreter = interpreter;
    this.maxComponentDepth = options.maxComponentDepth ?? DEFAULT_MAX_COMPONENT_DEPTH;
    this.maxFiberCount = options.maxFiberCount ?? DEFAULT_MAX_FIBER_COUNT;
    this.maxRecursionPerComponent =
      options.maxRecursionPerComponent ?? DEFAULT_MAX_RECURSION_PER_COMPONENT;
    this.supportsSingletons = options.supportsSingletons ?? true;
  }

  buildRoot(rootValue: StaticValue, location: SourceLocation | null): StaticElementFiber {
    const root = this.createElementFiber(
      HostRootTag,
      { kind: "host", tagName: "#root" },
      { kind: "host", tagName: "#root" },
      "HostRoot",
      null,
      { kind: "object", entries: [] },
      location,
    );
    const context: BuildContext = {
      depth: 0,
      contextFrame: null,
      componentStack: [],
      suspenseScope: null,
    };
    root.child = this.reconcileChildren(root, rootValue, context);
    return root;
  }

  private allocateId(): number {
    return this.nextId++;
  }

  private createElementFiber(
    tag: WorkTag,
    type: StaticElementType,
    elementType: StaticElementType,
    displayName: string | null,
    key: string | null,
    props: StaticObjectValue,
    location: SourceLocation | null,
  ): StaticElementFiber {
    this.stats.fiberCount++;
    return {
      id: this.allocateId(),
      kind: "fiber",
      tag,
      type,
      elementType,
      displayName,
      key,
      props,
      child: null,
      return: null,
      sibling: null,
      index: 0,
      location,
      notes: [],
    };
  }

  private createUnknownFiber(
    reason: string,
    location: SourceLocation | null,
    context?: BuildContext,
  ): StaticFiber {
    this.stats.unknownCount++;
    if (context) this.markMaySuspend(context);
    return {
      id: this.allocateId(),
      kind: "unknown",
      reason,
      return: null,
      sibling: null,
      index: 0,
      location,
    };
  }

  private markMaySuspend(context: BuildContext): void {
    if (context.suspenseScope) context.suspenseScope.maySuspend = true;
  }

  private link(parent: StaticFiber, children: StaticFiber[]): StaticFiber | null {
    let previous: StaticFiber | null = null;
    children.forEach((child, index) => {
      child.return = parent;
      child.index = index;
      child.sibling = null;
      if (previous) previous.sibling = child;
      previous = child;
    });
    return children[0] ?? null;
  }

  reconcileChildren(
    parent: StaticFiber,
    value: StaticValue,
    context: BuildContext,
  ): StaticFiber | null {
    const children: StaticFiber[] = [];
    this.appendChildFibers(value, context, children, true);
    return this.link(parent, children);
  }

  private appendChildFibers(
    value: StaticValue,
    context: BuildContext,
    out: StaticFiber[],
    isTopLevel: boolean,
  ): void {
    if (this.stats.fiberCount >= this.maxFiberCount) {
      if (!this.budgetExhausted) {
        this.budgetExhausted = true;
        this.interpreter.report(
          "max-fiber-count",
          `static fiber budget of ${this.maxFiberCount} exhausted`,
          null,
          "warning",
        );
      }
      out.push(this.createUnknownFiber("fiber budget exhausted", null));
      return;
    }
    if (isSkippedChild(value)) return;
    switch (value.kind) {
      case "primitive":
        this.stats.textCount++;
        out.push({
          id: this.allocateId(),
          kind: "text",
          tag: HostTextTag,
          text: String(value.value),
          return: null,
          sibling: null,
          index: 0,
          location: null,
        });
        return;
      case "unknown-primitive":
        if (value.primitiveType === "string" || value.primitiveType === "number") {
          this.stats.textCount++;
          out.push({
            id: this.allocateId(),
            kind: "text",
            tag: HostTextTag,
            text: null,
            return: null,
            sibling: null,
            index: 0,
            location: null,
          });
          return;
        }
        out.push(this.createUnknownFiber(`dynamic child (${value.reason})`, null));
        return;
      case "element":
        if (isTopLevel && value.type.kind === "fragment" && value.key === null) {
          this.appendChildFibers(getObjectProperty(value.props, "children"), context, out, true);
          return;
        }
        out.push(this.createFiberFromElement(value, context));
        return;
      case "list":
        if (isTopLevel) {
          for (const item of value.items) this.appendChildFibers(item, context, out, false);
          return;
        }
        out.push(this.createArrayFragment(value, context));
        return;
      case "repeat": {
        this.stats.repeatCount++;
        const repeat: StaticFiber = {
          id: this.allocateId(),
          kind: "repeat",
          child: null,
          return: null,
          sibling: null,
          index: 0,
          location: value.location,
        };
        const items: StaticFiber[] = [];
        this.appendChildFibers(value.item, context, items, true);
        repeat.child = this.link(repeat, items);
        if (isTopLevel) {
          out.push(repeat);
          return;
        }
        const fragment = this.createElementFiber(
          FragmentTag,
          { kind: "fragment" },
          { kind: "fragment" },
          null,
          null,
          { kind: "object", entries: [] },
          value.location,
        );
        fragment.notes.push("nested array rendered as an implicit Fragment");
        fragment.child = this.link(fragment, [repeat]);
        out.push(fragment);
        return;
      }
      case "branch": {
        this.stats.branchCount++;
        const branch: StaticFiber = {
          id: this.allocateId(),
          kind: "branch",
          alternatives: [],
          preferredIndex: value.preferredIndex,
          reason: value.reason,
          return: null,
          sibling: null,
          index: 0,
          location: value.location,
        };
        branch.alternatives = value.alternatives.map((alternative) => {
          const fibers: StaticFiber[] = [];
          this.appendChildFibers(alternative, context, fibers, isTopLevel);
          return this.link(branch, fibers);
        });
        out.push(branch);
        return;
      }
      case "unknown":
        out.push(this.createUnknownFiber(value.reason, value.location, context));
        return;
      case "external":
        out.push(
          this.createUnknownFiber(`value from ${value.packageName} (${value.importedName})`, null),
        );
        return;
      default:
        out.push(
          this.createUnknownFiber(`${describeValue(value)} is not a valid React child`, null),
        );
    }
  }

  private createArrayFragment(
    value: Extract<StaticValue, { kind: "list" }>,
    context: BuildContext,
  ): StaticFiber {
    const fragment = this.createElementFiber(
      FragmentTag,
      { kind: "fragment" },
      { kind: "fragment" },
      null,
      null,
      { kind: "object", entries: [] },
      null,
    );
    fragment.notes.push("nested array rendered as an implicit Fragment");
    const children: StaticFiber[] = [];
    for (const item of value.items) this.appendChildFibers(item, context, children, false);
    fragment.child = this.link(fragment, children);
    return fragment;
  }

  private keyToString(key: StaticValue | null, fiber: StaticElementFiber): string | null {
    if (!key) return null;
    if (key.kind === "primitive") {
      if (key.value === null || key.value === undefined) return null;
      return String(key.value);
    }
    fiber.notes.push(`key is dynamic (${describeValue(key)})`);
    return null;
  }

  private createFiberFromElement(element: StaticElementValue, context: BuildContext): StaticFiber {
    return this.createFiberFromTypeAndProps(
      element.type,
      element.type,
      element.key,
      element.props,
      element.location,
      context,
    );
  }

  private createFiberFromTypeAndProps(
    type: StaticElementType,
    elementType: StaticElementType,
    key: StaticValue | null,
    props: StaticObjectValue,
    location: SourceLocation | null,
    context: BuildContext,
  ): StaticFiber {
    const displayName = getElementDisplayName(type);
    const children = getObjectProperty(props, "children");
    switch (type.kind) {
      case "host": {
        const tag = this.getHostTag(type.tagName, props);
        const fiber = this.createElementFiber(
          tag,
          type,
          elementType,
          type.tagName,
          null,
          props,
          location,
        );
        fiber.key = this.keyToString(key, fiber);
        if (shouldSetTextContent(type.tagName, props)) {
          return fiber;
        }
        fiber.child = this.reconcileChildren(fiber, children, context);
        return fiber;
      }
      case "function":
        return this.renderFunctionFiber(
          FunctionComponentTag,
          type,
          elementType,
          displayName,
          key,
          props,
          location,
          context,
          type.component,
          null,
        );
      case "class": {
        const resolvedProps = applyDefaultProps(type.component, props);
        const fiber = this.createElementFiber(
          ClassComponentTag,
          type,
          elementType,
          displayName,
          null,
          resolvedProps,
          location,
        );
        fiber.key = this.keyToString(key, fiber);
        this.renderComposite(fiber, type.component, context, (componentContext) => {
          const classValue = this.toClassValue(type.component);
          return renderClassComponent(
            this.interpreter,
            classValue,
            resolvedProps,
            componentContext,
          );
        });
        return fiber;
      }
      case "memo": {
        if (
          type.inner.kind === "function" &&
          !type.hasCompare &&
          !hasDefaultProps(type.inner.component)
        ) {
          return this.renderFunctionFiber(
            SimpleMemoComponentTag,
            type.inner,
            elementType,
            displayName,
            key,
            props,
            location,
            context,
            type.inner.component,
            null,
          );
        }
        const fiber = this.createElementFiber(
          MemoComponentTag,
          type,
          elementType,
          displayName,
          null,
          props,
          location,
        );
        fiber.key = this.keyToString(key, fiber);
        const inner = this.createFiberFromTypeAndProps(
          type.inner,
          type.inner,
          null,
          props,
          location,
          this.descend(context),
        );
        fiber.child = this.link(fiber, [inner]);
        return fiber;
      }
      case "forward-ref": {
        const ref = getObjectProperty(props, "ref");
        const renderProps = omitObjectKeys(props, new Set(["ref"]));
        return this.renderFunctionFiber(
          ForwardRefTag,
          type,
          elementType,
          displayName,
          key,
          renderProps.kind === "object" ? renderProps : props,
          location,
          context,
          type.component,
          ref.kind === "primitive" && ref.value === undefined ? unknownValue("forwarded ref") : ref,
        );
      }
      case "lazy": {
        this.markMaySuspend(context);
        if (!type.inner) {
          const fiber = this.createElementFiber(
            LazyComponentTag,
            type,
            elementType,
            displayName,
            null,
            props,
            location,
          );
          fiber.key = this.keyToString(key, fiber);
          fiber.notes.push("lazy component target could not be resolved statically");
          fiber.child = this.link(fiber, [
            this.createUnknownFiber("unresolved lazy component", location, context),
          ]);
          return fiber;
        }
        const resolved = this.createFiberFromTypeAndProps(
          type.inner,
          elementType,
          key,
          props,
          location,
          context,
        );
        if (resolved.kind === "fiber")
          resolved.notes.push(
            "resolved from React.lazy; the nearest Suspense shows its fallback until the chunk loads",
          );
        return resolved;
      }
      case "fragment":
        return this.renderPassthrough(
          FragmentTag,
          type,
          elementType,
          null,
          key,
          props,
          location,
          context,
        );
      case "strict-mode":
        return this.renderPassthrough(
          ModeTag,
          type,
          elementType,
          displayName,
          key,
          props,
          location,
          context,
        );
      case "profiler":
        return this.renderPassthrough(
          ProfilerTag,
          type,
          elementType,
          displayName,
          key,
          props,
          location,
          context,
        );
      case "suspense-list":
        return this.renderPassthrough(
          SuspenseListComponentTag,
          type,
          elementType,
          displayName,
          key,
          props,
          location,
          context,
        );
      case "view-transition":
        return this.renderPassthrough(
          ViewTransitionComponentTag,
          type,
          elementType,
          displayName,
          key,
          props,
          location,
          context,
        );
      case "suspense":
        return this.renderSuspenseBoundary(
          type,
          elementType,
          displayName,
          key,
          props,
          location,
          context,
        );
      case "activity":
        return this.renderActivityBoundary(
          type,
          elementType,
          displayName,
          key,
          props,
          location,
          context,
        );
      case "context-provider": {
        const fiber = this.createElementFiber(
          ContextProviderTag,
          type,
          elementType,
          displayName,
          null,
          props,
          location,
        );
        fiber.key = this.keyToString(key, fiber);
        this.noteAnonymousContext(fiber, type.context);
        const nextFrame: ContextFrame | null = type.context
          ? {
              context: type.context,
              value: getObjectProperty(props, "value"),
              parent: context.contextFrame,
            }
          : context.contextFrame;
        fiber.child = this.reconcileChildren(fiber, children, {
          ...context,
          contextFrame: nextFrame,
        });
        return fiber;
      }
      case "context-consumer": {
        const fiber = this.createElementFiber(
          ContextConsumerTag,
          type,
          elementType,
          displayName,
          null,
          props,
          location,
        );
        fiber.key = this.keyToString(key, fiber);
        this.noteAnonymousContext(fiber, type.context);
        if (children.kind !== "function") {
          fiber.notes.push("Consumer children is not a function");
          fiber.child = this.link(fiber, [
            this.createUnknownFiber("Consumer render prop is dynamic", location),
          ]);
          return fiber;
        }
        const contextValue = type.context
          ? this.lookupContext(type.context, context)
          : unknownValue("context value from an unresolved context");
        const evaluationContext = this.interpreter.createModuleContext(
          children.module,
          context.contextFrame,
        );
        const rendered = this.interpreter.callFunction(children, [contextValue], evaluationContext);
        fiber.child = this.reconcileChildren(fiber, rendered, context);
        return fiber;
      }
      case "portal": {
        const fiber = this.createElementFiber(
          HostPortalTag,
          type,
          elementType,
          displayName,
          null,
          props,
          location,
        );
        fiber.key = this.keyToString(key, fiber);
        fiber.child = this.reconcileChildren(fiber, children, context);
        return fiber;
      }
      case "external": {
        this.stats.opaqueCount++;
        this.markMaySuspend(context);
        const opaque: StaticFiber = {
          id: this.allocateId(),
          kind: "opaque",
          displayName: type.displayName,
          packageName: type.packageName,
          key:
            key?.kind === "primitive" && key.value !== null && key.value !== undefined
              ? String(key.value)
              : null,
          props,
          passedChildren: null,
          reason: `${type.importedName} from ${type.packageName} is not analyzed`,
          return: null,
          sibling: null,
          index: 0,
          location,
        };
        opaque.passedChildren = this.reconcileChildren(opaque, children, context);
        return opaque;
      }
      case "unknown":
        return this.createUnknownFiber(
          `${type.displayName ? `<${type.displayName}>` : "element"}: ${type.reason}`,
          location,
          context,
        );
    }
  }

  private descend(context: BuildContext): BuildContext {
    return { ...context, depth: context.depth + 1 };
  }

  private getHostTag(tagName: string, props: StaticObjectValue): WorkTag {
    if (this.supportsSingletons && isHostSingleton(tagName)) return HostSingletonTag;
    if (this.supportsSingletons && isHostHoistable(tagName, props)) return HostHoistableTag;
    return HostComponentTag;
  }

  private renderPassthrough(
    tag: WorkTag,
    type: StaticElementType,
    elementType: StaticElementType,
    displayName: string | null,
    key: StaticValue | null,
    props: StaticObjectValue,
    location: SourceLocation | null,
    context: BuildContext,
  ): StaticFiber {
    const fiber = this.createElementFiber(
      tag,
      type,
      elementType,
      displayName,
      null,
      props,
      location,
    );
    fiber.key = this.keyToString(key, fiber);
    fiber.child = this.reconcileChildren(fiber, getObjectProperty(props, "children"), context);
    return fiber;
  }

  /** The reconciler's internal Offscreen fiber that wraps a boundary's primary children. */
  private createOffscreenFiber(
    mode: "visible" | "hidden",
    location: SourceLocation | null,
  ): StaticElementFiber {
    const internalType: StaticElementType = {
      kind: "unknown",
      displayName: "Offscreen",
      reason: "internal",
    };
    return this.createElementFiber(
      OffscreenComponentTag,
      internalType,
      internalType,
      "Offscreen",
      null,
      {
        kind: "object",
        entries: [{ kind: "property", key: "mode", value: { kind: "primitive", value: mode } }],
      },
      location,
    );
  }

  /**
   * Mirrors mountSuspensePrimaryChildren / mountSuspenseFallbackChildren: the
   * primary tree lives under a visible Offscreen fiber; while suspended React
   * instead mounts an empty hidden Offscreen followed by a Fragment holding the
   * fallback. The suspended shape is only emitted as an alternative when the
   * primary subtree contains something that can suspend (lazy, opaque, unknown).
   */
  private renderSuspenseBoundary(
    type: StaticElementType,
    elementType: StaticElementType,
    displayName: string | null,
    key: StaticValue | null,
    props: StaticObjectValue,
    location: SourceLocation | null,
    context: BuildContext,
  ): StaticFiber {
    const fiber = this.createElementFiber(
      SuspenseComponentTag,
      type,
      elementType,
      displayName,
      null,
      props,
      location,
    );
    fiber.key = this.keyToString(key, fiber);
    const suspenseScope: SuspenseScope = { maySuspend: false };
    const primary = this.createOffscreenFiber("visible", location);
    primary.notes.push("primary children");
    primary.child = this.reconcileChildren(primary, getObjectProperty(props, "children"), {
      ...context,
      suspenseScope,
    });
    if (!suspenseScope.maySuspend) {
      fiber.child = this.link(fiber, [primary]);
      return fiber;
    }
    const hidden = this.createOffscreenFiber("hidden", location);
    hidden.notes.push("primary children are not mounted while suspended");
    const fallbackType: StaticElementType = { kind: "fragment" };
    const fallback = this.createElementFiber(
      FragmentTag,
      fallbackType,
      fallbackType,
      null,
      null,
      { kind: "object", entries: [] },
      location,
    );
    fallback.notes.push("Suspense fallback");
    fallback.child = this.reconcileChildren(
      fallback,
      getObjectProperty(props, "fallback"),
      context,
    );
    this.stats.branchCount++;
    const branch: StaticFiber = {
      id: this.allocateId(),
      kind: "branch",
      alternatives: [],
      preferredIndex: 0,
      reason: "Suspense boundary may be suspended when observed",
      return: null,
      sibling: null,
      index: 0,
      location,
    };
    branch.alternatives = [this.link(branch, [primary]), this.link(branch, [hidden, fallback])];
    fiber.child = this.link(fiber, [branch]);
    return fiber;
  }

  /** `<Activity>` keeps its children mounted in both modes; only the Offscreen mode changes. */
  private renderActivityBoundary(
    type: StaticElementType,
    elementType: StaticElementType,
    displayName: string | null,
    key: StaticValue | null,
    props: StaticObjectValue,
    location: SourceLocation | null,
    context: BuildContext,
  ): StaticFiber {
    const fiber = this.createElementFiber(
      ActivityComponentTag,
      type,
      elementType,
      displayName,
      null,
      props,
      location,
    );
    fiber.key = this.keyToString(key, fiber);
    const mode = getObjectProperty(props, "mode");
    const offscreen = this.createOffscreenFiber(
      mode.kind === "primitive" && mode.value === "hidden" ? "hidden" : "visible",
      location,
    );
    if (mode.kind !== "primitive")
      offscreen.notes.push("Activity mode is dynamic; assumed visible");
    offscreen.child = this.reconcileChildren(
      offscreen,
      getObjectProperty(props, "children"),
      context,
    );
    fiber.child = this.link(fiber, [offscreen]);
    return fiber;
  }

  private renderFunctionFiber(
    tag: WorkTag,
    type: StaticElementType,
    elementType: StaticElementType,
    displayName: string | null,
    key: StaticValue | null,
    props: StaticObjectValue,
    location: SourceLocation | null,
    context: BuildContext,
    component: ComponentDefinition,
    secondArgument: StaticValue | null,
  ): StaticFiber {
    const fiber = this.createElementFiber(
      tag,
      type,
      elementType,
      displayName,
      null,
      props,
      location,
    );
    fiber.key = this.keyToString(key, fiber);
    this.renderComposite(fiber, component, context, (componentContext) => {
      const fn = this.toFunctionValue(component);
      const args = secondArgument ? [props, secondArgument] : [props];
      return this.interpreter.callFunction(fn, args, componentContext);
    });
    return fiber;
  }

  private renderComposite(
    fiber: StaticElementFiber,
    component: ComponentDefinition,
    context: BuildContext,
    render: (componentContext: ReturnType<Interpreter["createModuleContext"]>) => StaticValue,
  ): void {
    const location = fiber.location;
    if (context.depth >= this.maxComponentDepth) {
      this.interpreter.report(
        "max-component-depth",
        `component depth ${this.maxComponentDepth} exceeded at ${describeComponent(component)}`,
        location,
        "warning",
      );
      fiber.child = this.link(fiber, [
        this.createUnknownFiber("component depth exceeded", location),
      ]);
      return;
    }
    let occurrences = 0;
    for (const node of context.componentStack) if (node === component.node) occurrences++;
    if (occurrences >= this.maxRecursionPerComponent) {
      fiber.notes.push(
        `recursive render of ${describeComponent(component)} truncated after ${occurrences} levels`,
      );
      fiber.child = this.link(fiber, [
        this.createUnknownFiber(`recursive ${describeComponent(component)}`, location, context),
      ]);
      return;
    }
    const componentContext = this.interpreter.createModuleContext(
      component.module,
      context.contextFrame,
    );
    const rendered = render(componentContext);
    const childContext: BuildContext = {
      ...context,
      depth: context.depth + 1,
      componentStack: [...context.componentStack, component.node],
    };
    fiber.child = this.reconcileChildren(fiber, rendered, childContext);
  }

  private toFunctionValue(component: ComponentDefinition): StaticFunctionValue {
    const node = component.node;
    if (isClassNode(node)) {
      throw new Error(`${describeComponent(component)} is a class component`);
    }
    return {
      kind: "function",
      node,
      scope: component.scope,
      module: component.module,
      thisValue: null,
      name: component.name,
      properties: component.properties,
    };
  }

  private toClassValue(component: ComponentDefinition): StaticClassValue {
    const node = component.node;
    if (!isClassNode(node)) {
      throw new Error(`${describeComponent(component)} is not a class component`);
    }
    return {
      kind: "class",
      node,
      scope: component.scope,
      module: component.module,
      name: component.name,
      properties: component.properties,
    };
  }

  /** React only names context fibers from `displayName`; keep the binding name discoverable. */
  private noteAnonymousContext(
    fiber: StaticElementFiber,
    definition: ContextDefinition | null,
  ): void {
    if (definition && definition.displayName === null)
      fiber.notes.push(`context ${definition.name} has no displayName`);
  }

  private lookupContext(
    definition: NonNullable<Extract<StaticElementType, { kind: "context-consumer" }>["context"]>,
    context: BuildContext,
  ): StaticValue {
    let frame = context.contextFrame;
    while (frame) {
      if (frame.context === definition) return frame.value;
      frame = frame.parent;
    }
    return definition.defaultValue;
  }
}

export const describeFiberType = (fiber: StaticFiber): string => {
  switch (fiber.kind) {
    case "fiber":
      return fiber.displayName ?? describeElementType(fiber.type);
    case "text":
      return fiber.text === null ? "#text(dynamic)" : `#text(${JSON.stringify(fiber.text)})`;
    case "branch":
      return `?branch(${fiber.reason})`;
    case "repeat":
      return "*repeat";
    case "opaque":
      return `<${fiber.displayName}> (opaque)`;
    case "unknown":
      return `?unknown(${fiber.reason})`;
  }
};
