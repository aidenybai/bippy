import { instantiateClassComponent } from "../analyze/components.js";
import {
  EMPTY_CONTEXTS,
  provideContext,
  type ProvidedContexts,
  readContext,
} from "../analyze/contexts.js";
import type { EvaluationContext, Interpreter } from "../analyze/interpreter.js";
import {
  type BuiltinComponentName,
  cloneObject,
  type ComponentDefinition,
  component,
  describeValue,
  type ElementValue,
  type FunctionValue,
  getComponentName,
  getObjectProperty,
  getValueName,
  type ListValue,
  NULL,
  object,
  type ObjectValue,
  type StaticValue,
  unknown,
} from "../analyze/values.js";
import { getHostWorkTag, isDirectTextChild, shouldSetTextContent } from "./host.js";
import type {
  BranchNode,
  ListNode,
  StaticFiber,
  StaticNode,
  StaticRoot,
  UnknownNode,
  WorkTagName,
} from "./types.js";

export interface BuildOptions {
  /** Component render nesting after which subtrees become unknown. */
  maxRenderDepth?: number;
  /** Times one component may appear in its own ancestry before the recursion is cut. */
  maxRecursion?: number;
  /** Total fiber budget for one tree. */
  maxFiberCount?: number;
}

interface Frame {
  contexts: ProvidedContexts;
  depth: number;
  isInsideSvg: boolean;
  /** Component implementations currently rendering, outermost first. */
  renderStack: readonly object[];
}

interface Builder {
  interpreter: Interpreter;
  options: Required<BuildOptions>;
  fiberCount: number;
  unknownCount: number;
}

interface FiberInit {
  tag: WorkTagName | null;
  name: string | null;
  element: ElementValue | null;
  owner: StaticFiber | null;
}

const ROOT_FRAME: Frame = { contexts: EMPTY_CONTEXTS, depth: 0, isInsideSvg: false, renderStack: [] };

const BUILTIN_FIBER_NAMES: Record<BuiltinComponentName, string> = {
  Fragment: "Fragment",
  Suspense: "Suspense",
  SuspenseList: "SuspenseList",
  StrictMode: "StrictMode",
  Profiler: "Profiler",
  Activity: "Activity",
  ViewTransition: "ViewTransition",
  Portal: "Portal",
};

const childrenOf = (props: ObjectValue): StaticValue => getObjectProperty(props, "children");

const isUnkeyedFragment = (value: StaticValue): value is ElementValue =>
  value.kind === "element" &&
  value.key === null &&
  value.type.kind === "component" &&
  value.type.definition.kind === "builtin" &&
  value.type.definition.name === "Fragment";

/** React coerces keys with `"" + key`; keys only known at runtime stay `null`. */
const getKey = (key: StaticValue | null): string | null => {
  if (key === null || key.kind !== "literal" || key.value == null) return null;
  return String(key.value);
};

const unknownNode = (builder: Builder, description: string): UnknownNode => {
  builder.unknownCount++;
  return { kind: "unknown", description };
};

const branch = (test: string, alternatives: StaticNode[][]): StaticNode[] => {
  if (alternatives.every((alternative) => alternative.length === 0)) return [];
  const node: BranchNode = { kind: "branch", test, alternatives };
  return [node];
};

const createFiber = (builder: Builder, parent: StaticFiber | null, init: FiberInit): StaticFiber => {
  builder.fiberCount++;
  const element = init.element;
  return {
    kind: "fiber",
    tag: init.tag,
    name: init.name,
    key: element ? getKey(element.key) : null,
    text: null,
    props: element?.props ?? null,
    type: element?.type ?? null,
    location: element?.location ?? null,
    owner: init.owner,
    parent,
    children: [],
    hooks: [],
    annotations: [],
    fallback: null,
  };
};

const createTextFiber = (builder: Builder, parent: StaticFiber, text: string | null): StaticFiber => ({
  ...createFiber(builder, parent, { tag: "HostText", name: null, element: null, owner: parent }),
  text,
});

const isOverBudget = (builder: Builder): boolean => builder.fiberCount >= builder.options.maxFiberCount;

/**
 * `reconcileChildFibers`: the value a render returned (or a `children`
 * prop) becomes a sequence of sibling fibers. A top-level array is a set of
 * children and a top-level unkeyed fragment is unwrapped once.
 */
const reconcileChildren = (
  builder: Builder,
  parent: StaticFiber,
  value: StaticValue,
  frame: Frame,
  canUnwrapFragment = true,
): StaticNode[] => {
  if (isOverBudget(builder)) return [unknownNode(builder, "fiber budget exceeded")];
  switch (value.kind) {
    case "conditional":
      return branch(value.test, [
        reconcileChildren(builder, parent, value.whenTrue, frame, canUnwrapFragment),
        reconcileChildren(builder, parent, value.whenFalse, frame, canUnwrapFragment),
      ]);
    case "element":
      if (canUnwrapFragment && isUnkeyedFragment(value)) {
        return reconcileChildren(builder, parent, childrenOf(value.props), frame, false);
      }
      return createFiberFromElement(builder, parent, value, frame);
    case "array":
      return reconcileArray(builder, parent, value.items, frame);
    case "list":
      return [createListNode(builder, parent, value, frame)];
    default:
      return createChild(builder, parent, value, frame);
  }
};

const reconcileArray = (
  builder: Builder,
  parent: StaticFiber,
  items: StaticValue[],
  frame: Frame,
): StaticNode[] => items.flatMap((item) => createChild(builder, parent, item, frame));

/**
 * `createChild`: one entry of a children array. Nested arrays and fragments
 * become `Fragment` fibers, text becomes `HostText`, and `null`/booleans/`""`
 * render nothing.
 */
const createChild = (
  builder: Builder,
  parent: StaticFiber,
  value: StaticValue,
  frame: Frame,
): StaticNode[] => {
  if (isOverBudget(builder)) return [unknownNode(builder, "fiber budget exceeded")];
  switch (value.kind) {
    case "literal": {
      const primitive = value.value;
      if (typeof primitive === "string") return primitive === "" ? [] : [createTextFiber(builder, parent, primitive)];
      if (typeof primitive === "number" || typeof primitive === "bigint") {
        return [createTextFiber(builder, parent, String(primitive))];
      }
      return [];
    }
    case "text":
      return [createTextFiber(builder, parent, null)];
    case "conditional":
      return branch(value.test, [
        createChild(builder, parent, value.whenTrue, frame),
        createChild(builder, parent, value.whenFalse, frame),
      ]);
    case "element":
      return createFiberFromElement(builder, parent, value, frame);
    case "array":
      return [createArrayFragment(builder, parent, value.items, frame)];
    case "list": {
      if (value.isInline) return [createListNode(builder, parent, value, frame)];
      const fiber = createFragmentFiber(builder, parent);
      fiber.children = [createListNode(builder, fiber, value, frame)];
      return [fiber];
    }
    case "unknown":
      return [unknownNode(builder, value.description)];
    default:
      return [unknownNode(builder, `child ${describeValue(value)}`)];
  }
};

/** Nested arrays and iterables reconcile as a keyless `Fragment` fiber owned by the parent. */
const createFragmentFiber = (builder: Builder, parent: StaticFiber): StaticFiber =>
  createFiber(builder, parent, { tag: "Fragment", name: null, element: null, owner: parent });

const createArrayFragment = (
  builder: Builder,
  parent: StaticFiber,
  items: StaticValue[],
  frame: Frame,
): StaticFiber => {
  const fiber = createFragmentFiber(builder, parent);
  fiber.children = reconcileArray(builder, fiber, items, frame);
  return fiber;
};

const createListNode = (
  builder: Builder,
  parent: StaticFiber,
  value: ListValue,
  frame: Frame,
): ListNode => {
  const items =
    value.isFlat && value.item.kind === "array"
      ? reconcileArray(builder, parent, value.item.items, frame)
      : createChild(builder, parent, value.item, frame);
  return { kind: "list", description: value.description, items };
};

const createOpaqueFiber = (
  builder: Builder,
  parent: StaticFiber,
  element: ElementValue,
  name: string | null,
  reason: string,
): StaticFiber => {
  const fiber = createFiber(builder, parent, { tag: null, name, element, owner: element.owner });
  fiber.annotations.push("opaque");
  fiber.children = [unknownNode(builder, reason)];
  return fiber;
};

/** `createFiberFromTypeAndProps`: the element type decides the fiber's work tag. */
const createFiberFromElement = (
  builder: Builder,
  parent: StaticFiber,
  element: ElementValue,
  frame: Frame,
): StaticNode[] => {
  const type = element.type;
  switch (type.kind) {
    case "literal":
      if (typeof type.value === "string") {
        return [createHostFiber(builder, parent, element, type.value, frame)];
      }
      return [createOpaqueFiber(builder, parent, element, null, `element type ${describeValue(type)}`)];
    case "function":
      return [createFunctionComponentFiber(builder, parent, element, type, frame)];
    case "component":
      return createFiberFromDefinition(builder, parent, element, type.definition, frame);
    case "conditional":
      return branch(type.test, [
        createFiberFromElement(builder, parent, { ...element, type: type.whenTrue }, frame),
        createFiberFromElement(builder, parent, { ...element, type: type.whenFalse }, frame),
      ]);
    case "external":
      return [
        createOpaqueFiber(builder, parent, element, type.name, `implementation of ${type.name ?? type.specifier}`),
      ];
    default:
      return [createOpaqueFiber(builder, parent, element, getValueName(type), describeValue(type))];
  }
};

const createHostFiber = (
  builder: Builder,
  parent: StaticFiber,
  element: ElementValue,
  tagName: string,
  frame: Frame,
): StaticFiber => {
  const tag = getHostWorkTag(tagName, element.props, frame.isInsideSvg);
  const fiber = createFiber(builder, parent, { tag, name: tagName, element, owner: element.owner });
  if (tag === "HostHoistable" || shouldSetTextContent(tagName, element.props)) return fiber;
  const childFrame =
    tagName === "svg"
      ? { ...frame, isInsideSvg: true }
      : tagName === "foreignObject"
        ? { ...frame, isInsideSvg: false }
        : frame;
  fiber.children = reconcileHostChildren(builder, fiber, childrenOf(element.props), childFrame);
  return fiber;
};

/** A lone string child is written as `textContent`, so it produces no fiber. */
const reconcileHostChildren = (
  builder: Builder,
  parent: StaticFiber,
  value: StaticValue,
  frame: Frame,
): StaticNode[] => {
  if (isDirectTextChild(value)) return [];
  if (value.kind === "conditional") {
    return branch(value.test, [
      reconcileHostChildren(builder, parent, value.whenTrue, frame),
      reconcileHostChildren(builder, parent, value.whenFalse, frame),
    ]);
  }
  return reconcileChildren(builder, parent, value, frame);
};

const createRenderContext = (builder: Builder, fiber: StaticFiber, module: FunctionValue["module"], frame: Frame): EvaluationContext => ({
  ...builder.interpreter.createModuleContext(module),
  owner: fiber,
  hooks: fiber.hooks,
  contexts: frame.contexts,
});

/** Evaluates a component body and reconciles what it returned under `fiber`. */
const renderInto = (
  builder: Builder,
  fiber: StaticFiber,
  render: FunctionValue,
  callArguments: StaticValue[],
  frame: Frame,
): StaticNode[] => {
  const displayName = fiber.name ?? "anonymous component";
  if (frame.depth >= builder.options.maxRenderDepth) {
    builder.interpreter.report("call-depth", `render depth limit reached at ${displayName}`, render.module, render.fn);
    return [unknownNode(builder, `render depth limit at ${displayName}`)];
  }
  const recursion = frame.renderStack.filter((entry) => entry === render.fn).length;
  if (recursion >= builder.options.maxRecursion) {
    return [unknownNode(builder, `recursive render of ${displayName}`)];
  }
  const context = createRenderContext(builder, fiber, render.module, frame);
  const result = builder.interpreter.callFunction(render, callArguments, context);
  const childFrame: Frame = {
    ...frame,
    depth: frame.depth + 1,
    renderStack: [...frame.renderStack, render.fn],
  };
  return reconcileChildren(builder, fiber, result, childFrame);
};

const createFunctionComponentFiber = (
  builder: Builder,
  parent: StaticFiber,
  element: ElementValue,
  fn: FunctionValue,
  frame: Frame,
  tag: WorkTagName = "FunctionComponent",
): StaticFiber => {
  const fiber = createFiber(builder, parent, { tag, name: fn.name, element, owner: element.owner });
  fiber.children = renderInto(builder, fiber, fn, [element.props], frame);
  return fiber;
};

const createFiberFromDefinition = (
  builder: Builder,
  parent: StaticFiber,
  element: ElementValue,
  definition: ComponentDefinition,
  frame: Frame,
): StaticNode[] => {
  const name = getComponentName(definition);
  const owner = element.owner;
  switch (definition.kind) {
    case "builtin":
      return [createBuiltinFiber(builder, parent, element, definition.name, frame)];
    case "class": {
      const fiber = createFiber(builder, parent, { tag: "ClassComponent", name, element, owner });
      if (definition.isErrorBoundary) fiber.annotations.push("error boundary");
      const context = createRenderContext(builder, fiber, definition.module, frame);
      const { render } = instantiateClassComponent(builder.interpreter, definition, element.props, context);
      fiber.children = render
        ? renderInto(builder, fiber, render, [], frame)
        : [unknownNode(builder, `render() of ${name ?? "class component"}`)];
      return [fiber];
    }
    case "memo": {
      const inner = definition.inner;
      if (inner.kind === "function" && !definition.hasCompare) {
        return [createFunctionComponentFiber(builder, parent, element, inner, frame, "SimpleMemoComponent")];
      }
      const fiber = createFiber(builder, parent, { tag: "MemoComponent", name, element, owner });
      fiber.children = createFiberFromElement(
        builder,
        fiber,
        { ...element, type: inner, key: null, owner: fiber },
        frame,
      );
      return [fiber];
    }
    case "forwardRef": {
      const fiber = createFiber(builder, parent, { tag: "ForwardRef", name, element, owner });
      if (!definition.render) {
        fiber.children = [unknownNode(builder, `render of ${name ?? "forwardRef"}`)];
        return [fiber];
      }
      const props = cloneObject(element.props);
      const ref = props.properties.get("ref") ?? NULL;
      props.properties.delete("ref");
      fiber.children = renderInto(builder, fiber, definition.render, [props, ref], frame);
      return [fiber];
    }
    case "lazy": {
      const nodes = createFiberFromElement(builder, parent, { ...element, type: definition.inner }, frame);
      for (const node of nodes) if (node.kind === "fiber") node.annotations.push("lazy");
      return nodes;
    }
    case "context":
      return [createContextFiber(builder, parent, element, definition, frame)];
  }
};

const createContextFiber = (
  builder: Builder,
  parent: StaticFiber,
  element: ElementValue,
  definition: Extract<ComponentDefinition, { kind: "context" }>,
  frame: Frame,
): StaticFiber => {
  const baseName = definition.name ?? "Context";
  if (definition.role === "provider") {
    const fiber = createFiber(builder, parent, {
      tag: "ContextProvider",
      name: `${baseName}.Provider`,
      element,
      owner: element.owner,
    });
    const value = getObjectProperty(element.props, "value");
    const childFrame = { ...frame, contexts: provideContext(frame.contexts, definition, value) };
    fiber.children = reconcileChildren(builder, fiber, childrenOf(element.props), childFrame);
    return fiber;
  }
  const fiber = createFiber(builder, parent, {
    tag: "ContextConsumer",
    name: `${baseName}.Consumer`,
    element,
    owner: element.owner,
  });
  const render = childrenOf(element.props);
  const contextValue = readContext(frame.contexts, component(definition));
  fiber.children =
    render.kind === "function"
      ? renderInto(builder, fiber, render, [contextValue], frame)
      : [unknownNode(builder, `consumer render ${describeValue(render)}`)];
  return fiber;
};

const createOffscreenFiber = (
  builder: Builder,
  parent: StaticFiber,
  children: StaticValue,
  mode: string,
  frame: Frame,
): StaticFiber => {
  const fiber = createFiber(builder, parent, { tag: "OffscreenComponent", name: "Offscreen", element: null, owner: parent.owner });
  fiber.annotations.push(`mode=${mode}`);
  fiber.children = reconcileChildren(builder, fiber, children, frame);
  return fiber;
};

/**
 * Built-in element types. `Suspense` and `Activity` mount their children
 * inside an `Offscreen` fiber (`mountSuspensePrimaryChildren`,
 * `mountActivityChildren`); the others reconcile children directly.
 */
const createBuiltinFiber = (
  builder: Builder,
  parent: StaticFiber,
  element: ElementValue,
  name: BuiltinComponentName,
  frame: Frame,
): StaticFiber => {
  const props = element.props;
  const fiber = createFiber(builder, parent, {
    tag: getBuiltinWorkTag(name),
    name: BUILTIN_FIBER_NAMES[name],
    element,
    owner: element.owner,
  });
  switch (name) {
    case "Suspense":
      fiber.children = [createOffscreenFiber(builder, fiber, childrenOf(props), "visible", frame)];
      fiber.fallback = reconcileChildren(builder, fiber, getObjectProperty(props, "fallback"), frame);
      return fiber;
    case "Activity": {
      const mode = getObjectProperty(props, "mode");
      const modeName = mode.kind === "literal" && typeof mode.value === "string" ? mode.value : "visible";
      fiber.children = [createOffscreenFiber(builder, fiber, childrenOf(props), modeName, frame)];
      return fiber;
    }
    default:
      fiber.children = reconcileChildren(builder, fiber, childrenOf(props), frame);
      return fiber;
  }
};

const getBuiltinWorkTag = (name: BuiltinComponentName): WorkTagName => {
  switch (name) {
    case "Fragment":
      return "Fragment";
    case "Suspense":
      return "SuspenseComponent";
    case "SuspenseList":
      return "SuspenseListComponent";
    case "StrictMode":
      return "Mode";
    case "Profiler":
      return "Profiler";
    case "Activity":
      return "ActivityComponent";
    case "ViewTransition":
      return "ViewTransitionComponent";
    case "Portal":
      return "HostPortal";
  }
};

const DEFAULT_OPTIONS: Required<BuildOptions> = {
  maxRenderDepth: 64,
  maxRecursion: 2,
  maxFiberCount: 50_000,
};

/** Builds the fiber tree `root.render(value)` would commit, under a `HostRoot`. */
export const buildStaticTree = (
  interpreter: Interpreter,
  value: StaticValue,
  options: BuildOptions = {},
): StaticRoot => {
  const builder: Builder = {
    interpreter,
    options: { ...DEFAULT_OPTIONS, ...options },
    fiberCount: 0,
    unknownCount: 0,
  };
  const root = createFiber(builder, null, { tag: "HostRoot", name: null, element: null, owner: null });
  root.children = reconcileChildren(builder, root, value, ROOT_FRAME);
  return { root, fiberCount: builder.fiberCount, unknownCount: builder.unknownCount };
};

/** Builds the tree for `<Component {...props} />` rendered at the root. */
export const buildComponentTree = (
  interpreter: Interpreter,
  componentValue: StaticValue,
  props: ObjectValue = object(),
  options: BuildOptions = {},
): StaticRoot => {
  const element: ElementValue = {
    kind: "element",
    type: componentValue,
    key: null,
    props,
    location: null,
    owner: null,
  };
  if (componentValue.kind === "unknown") {
    return buildStaticTree(interpreter, unknown(`root ${componentValue.description}`), options);
  }
  return buildStaticTree(interpreter, element, options);
};
