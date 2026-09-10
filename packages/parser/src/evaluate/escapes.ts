import type {
  BindingPattern,
  BindingRestElement,
  JSXElement,
  MemberExpression,
  Node,
  ParamPattern,
} from "oxc-parser";
import type {
  FunctionLikeNode,
  ModuleRecord,
  StaticFunctionValue,
  StaticNativeFunctionValue,
  StaticPrimitiveValue,
  StaticValue,
} from "../types.js";
import { forEachChildNode, isFunctionLikeNode } from "../parse/ast-walk.js";
import type { EscapeArguments, EscapeDependency, EscapeMemo, EscapeTuple } from "./escape-memo.js";
import { isUserDrivenEventHandlerProp } from "./event-listeners.js";
import { findOwningScope } from "./scope.js";
import { getObjectProperty, primitiveValue } from "./values.js";

/** `context[key]`: a member read whose key is the string another path names. */
export interface ComputedAccess {
  keyPath: AccessPath;
}

export type AccessStep = string | ComputedAccess;

/** `this`, `editor`, `callbackRef.current`, `this.update`, `system[key]`: a value named from inside a closure body. */
export type AccessPath = [root: string, ...members: AccessStep[]];

const getReceiverPath = ([root, ...members]: AccessPath): AccessPath => [
  root,
  ...members.slice(0, -1),
];

/**
 * A mutation a closure body performs: `editor._dirty = true` assigns `key` on
 * the object at `target`, `obj[dynamic] = v` assigns an unknown key,
 * `cache.set(k, v)` or `items.push(x)` calls the mutating method `key`, and
 * `found = x` rebinds the captured variable at `target`.
 */
export interface EscapedMutation {
  target: AccessPath;
  key: string | null;
  kind: "member" | "method" | "rebinding";
  bindings: ItemBinding[];
}

/** `queue.forEach((entry) => …)`: inside the callback, `name` is an item of the list at `receiver`. */
export interface ItemBinding {
  name: string;
  receiver: AccessPath;
}

/** An argument at an escaped call site: a plain path, a literal, or neither (`{ onDone: setX }`, `x + 1`). */
interface EscapedArgument {
  path: AccessPath | null;
  literal: StaticPrimitiveValue | null;
}

interface EscapedCallSite {
  callee: AccessPath | null;
  arguments: EscapedArgument[];
  /** Paths inside arguments that are neither plain paths nor literals. */
  nestedPaths: AccessPath[];
  /** The iteration callbacks the call site sits in, outermost first. */
  bindings: ItemBinding[];
}

interface ClosureShape {
  parameterNames: (string | null)[];
  declaredNames: Set<string>;
  callSites: EscapedCallSite[];
}

/**
 * Arguments a callable was invoked with along the escaped call chain: by
 * position (null where the walk cannot tell the value) and, for closures, by
 * parameter name.
 */
export interface EscapeFrame {
  arguments: (StaticValue | null)[];
  parameters: Map<string, StaticValue>;
}

export interface EscapeWalk {
  visit: (
    callable: StaticFunctionValue | StaticNativeFunctionValue,
    frame: EscapeFrame | null,
  ) => void;
  resolveModuleBinding: (module: ModuleRecord, name: string) => StaticValue | null;
  memo: EscapeMemo;
}

type RecordDependency = (dependency: EscapeDependency, key: string) => void;

/** Containers one walk already traversed: in full, or only for the callables they hand to an unresolved callee. */
interface EscapeVisits {
  escaped: Set<StaticValue>;
  handed: Set<StaticValue>;
}

const getStaticMemberKey = (member: MemberExpression): string | null => {
  if (!member.computed) return member.property.type === "Identifier" ? member.property.name : null;
  return member.property.type === "Literal" && typeof member.property.value === "string"
    ? member.property.value
    : null;
};

const getAccessPath = (node: Node): AccessPath | null => {
  switch (node.type) {
    case "Identifier":
      return [node.name];
    case "ThisExpression":
      return ["this"];
    case "MemberExpression": {
      const objectPath = getAccessPath(node.object);
      if (!objectPath) return null;
      const key = getStaticMemberKey(node);
      if (key !== null) return [...objectPath, key];
      const keyPath = node.computed ? getAccessPath(node.property) : null;
      return keyPath ? [...objectPath, { keyPath }] : null;
    }
    case "ParenthesizedExpression":
    case "TSNonNullExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
      return getAccessPath(node.expression);
    default:
      return null;
  }
};

const getLiteralValue = (node: Node): StaticPrimitiveValue | null => {
  switch (node.type) {
    case "Literal":
      return node.value === null ||
        typeof node.value === "boolean" ||
        typeof node.value === "number" ||
        typeof node.value === "string"
        ? primitiveValue(node.value)
        : null;
    case "TemplateLiteral":
      return node.expressions.length === 0 && node.quasis[0]?.value.cooked !== undefined
        ? primitiveValue(node.quasis[0].value.cooked)
        : null;
    case "ParenthesizedExpression":
    case "TSNonNullExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
      return getLiteralValue(node.expression);
    default:
      return null;
  }
};

const collectAccessPaths = (node: Node, paths: AccessPath[]): void => {
  const path = getAccessPath(node);
  if (path) {
    paths.push(path);
    return;
  }
  if (isFunctionLikeNode(node)) return;
  forEachChildNode(node, (child) => collectAccessPaths(child, paths));
};

const collectPatternNames = (
  pattern: BindingPattern | BindingRestElement,
  names: Set<string>,
): void => {
  switch (pattern.type) {
    case "Identifier":
      names.add(pattern.name);
      return;
    case "AssignmentPattern":
      collectPatternNames(pattern.left, names);
      return;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        if (element) collectPatternNames(element, names);
      }
      return;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        collectPatternNames(
          property.type === "RestElement" ? property.argument : property.value,
          names,
        );
      }
      return;
    case "RestElement":
      collectPatternNames(pattern.argument, names);
      return;
    default:
      return;
  }
};

const getParameterPattern = (parameter: ParamPattern): BindingPattern =>
  parameter.type === "RestElement"
    ? parameter.argument
    : parameter.type === "TSParameterProperty"
      ? parameter.parameter
      : parameter;

const getParameterNames = (parameters: ParamPattern[]): (string | null)[] =>
  parameters.map((parameter) => {
    if (parameter.type === "RestElement") return null;
    const pattern = getParameterPattern(parameter);
    return pattern.type === "Identifier" ? pattern.name : null;
  });

/** Array methods that call their callback once per item, the item first. */
const ITERATION_METHODS = new Set([
  "forEach",
  "map",
  "flatMap",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
]);

interface IterationCallback {
  callback: Node;
  binding: ItemBinding;
}

const getIterationCallback = (node: Node): IterationCallback | null => {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return null;
  const method = node.callee.computed ? null : node.callee.property;
  if (method?.type !== "Identifier" || !ITERATION_METHODS.has(method.name)) return null;
  const receiver = getAccessPath(node.callee.object);
  const [callback] = node.arguments;
  if (
    !receiver ||
    !callback ||
    (callback.type !== "FunctionExpression" && callback.type !== "ArrowFunctionExpression")
  ) {
    return null;
  }
  const [name] = getParameterNames(callback.params);
  return name ? { callback, binding: { name, receiver } } : null;
};

/** Visits the children of `node`, the callback of an iteration call with its item bound. */
const forEachChildWithBindings = (
  node: Node,
  bindings: ItemBinding[],
  visit: (child: Node, bindings: ItemBinding[]) => void,
): void => {
  const iteration = getIterationCallback(node);
  forEachChildNode(node, (child) => {
    visit(child, iteration?.callback === child ? [...bindings, iteration.binding] : bindings);
  });
};

/**
 * An element an escaped closure creates is rendered by whoever the closure
 * returned it to: its `ref` and props reach code the walk cannot follow, the
 * way props of an opaque component do, except handlers only a user gesture fires.
 */
const getElementPaths = (element: JSXElement): AccessPath[] => {
  const paths: AccessPath[] = [];
  for (const attribute of element.openingElement.attributes) {
    if (attribute.type === "JSXSpreadAttribute") {
      collectAccessPaths(attribute.argument, paths);
      continue;
    }
    const { name, value } = attribute;
    if (name.type === "JSXIdentifier" && isUserDrivenEventHandlerProp(name.name)) continue;
    if (value?.type === "JSXExpressionContainer") collectAccessPaths(value.expression, paths);
  }
  for (const child of element.children) {
    if (child.type === "JSXExpressionContainer") collectAccessPaths(child.expression, paths);
  }
  return paths;
};

const collectClosureShape = (node: Node, shape: ClosureShape, bindings: ItemBinding[]): void => {
  switch (node.type) {
    case "JSXElement":
      shape.callSites.push({
        callee: null,
        arguments: [],
        nestedPaths: getElementPaths(node),
        bindings,
      });
      break;
    case "CallExpression":
    case "NewExpression": {
      const nestedPaths: AccessPath[] = [];
      const escapedArguments = node.arguments.map((argument): EscapedArgument => {
        const path = getAccessPath(argument);
        const literal = path ? null : getLiteralValue(argument);
        if (!path && !literal) collectAccessPaths(argument, nestedPaths);
        return { path, literal };
      });
      shape.callSites.push({
        callee: getAccessPath(node.callee),
        arguments: escapedArguments,
        nestedPaths,
        bindings,
      });
      break;
    }
    case "VariableDeclarator":
      collectPatternNames(node.id, shape.declaredNames);
      break;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      for (const parameter of node.params) {
        collectPatternNames(getParameterPattern(parameter), shape.declaredNames);
      }
      if (node.type === "FunctionDeclaration" && node.id) shape.declaredNames.add(node.id.name);
      break;
    case "ClassDeclaration":
      if (node.id) shape.declaredNames.add(node.id.name);
      break;
    case "CatchClause":
      if (node.param) collectPatternNames(node.param, shape.declaredNames);
      break;
    default:
      break;
  }
  forEachChildWithBindings(node, bindings, (child, childBindings) =>
    collectClosureShape(child, shape, childBindings),
  );
};

const closureShapeCache = new WeakMap<FunctionLikeNode, ClosureShape>();

const getClosureShape = (functionNode: FunctionLikeNode): ClosureShape => {
  const cached = closureShapeCache.get(functionNode);
  if (cached) return cached;
  const shape: ClosureShape = {
    parameterNames: getParameterNames(functionNode.params),
    declaredNames: new Set(),
    callSites: [],
  };
  collectClosureShape(functionNode, shape, []);
  for (const name of shape.parameterNames) {
    if (name !== null) shape.declaredNames.delete(name);
  }
  closureShapeCache.set(functionNode, shape);
  return shape;
};

const MUTATING_METHODS = new Set([
  "set",
  "add",
  "delete",
  "clear",
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

const getAssignedMutation = (assigned: Node, bindings: ItemBinding[]): EscapedMutation | null => {
  if (assigned.type === "Identifier") {
    return { target: [assigned.name], key: null, kind: "rebinding", bindings };
  }
  if (assigned.type !== "MemberExpression") return null;
  const target = getAccessPath(assigned.object);
  return target ? { target, key: getStaticMemberKey(assigned), kind: "member", bindings } : null;
};

const getMutation = (node: Node, bindings: ItemBinding[]): EscapedMutation | null => {
  switch (node.type) {
    case "CallExpression": {
      const callee = node.callee;
      if (callee.type !== "MemberExpression") return null;
      const method = callee.computed ? null : callee.property;
      if (method?.type !== "Identifier" || !MUTATING_METHODS.has(method.name)) return null;
      const target = getAccessPath(callee.object);
      return target ? { target, key: method.name, kind: "method", bindings } : null;
    }
    case "AssignmentExpression":
      return getAssignedMutation(node.left, bindings);
    case "UpdateExpression":
      return getAssignedMutation(node.argument, bindings);
    case "UnaryExpression":
      return node.operator === "delete" && node.argument.type === "MemberExpression"
        ? getAssignedMutation(node.argument, bindings)
        : null;
    default:
      return null;
  }
};

const collectMutations = (
  node: Node,
  mutations: EscapedMutation[],
  bindings: ItemBinding[],
): void => {
  const mutation = getMutation(node, bindings);
  if (mutation) mutations.push(mutation);
  forEachChildWithBindings(node, bindings, (child, childBindings) =>
    collectMutations(child, mutations, childBindings),
  );
};

const mutationsCache = new WeakMap<FunctionLikeNode, EscapedMutation[]>();

/** The in-place mutations a function (or a function nested in it) performs. */
export const getEscapedMutations = (functionNode: FunctionLikeNode): EscapedMutation[] => {
  const cached = mutationsCache.get(functionNode);
  if (cached) return cached;
  const mutations: EscapedMutation[] = [];
  collectMutations(functionNode, mutations, []);
  mutationsCache.set(functionNode, mutations);
  return mutations;
};

/**
 * The values an identifier names inside an escaped closure: an argument bound
 * along the escaped call chain, the items of the list an enclosing iteration
 * callback runs over, a captured variable, or a module binding. Locals the
 * closure declares itself hold values that only exist once it runs.
 */
const resolveEscapedIdentifier = (
  closure: StaticFunctionValue,
  frame: EscapeFrame | null,
  name: string,
  bindings: ItemBinding[],
  walk: EscapeWalk,
  record: RecordDependency,
): StaticValue[] => {
  const bound = frame?.parameters.get(name);
  if (bound) return [bound];
  const bindingIndex = bindings.findLastIndex((binding) => binding.name === name);
  if (bindingIndex >= 0) {
    const receivers = resolveAccessPath(
      closure,
      frame,
      bindings[bindingIndex].receiver,
      walk,
      bindings.slice(0, bindingIndex),
    );
    return getItemValues(receivers, record);
  }
  if (isClosureLocal(closure, name)) return [];
  const owner = findOwningScope(closure.scope, name);
  if (owner) {
    record(owner, name);
    const captured = owner.bindings.get(name);
    return captured ? [captured] : [];
  }
  record(closure.module, name);
  const moduleValue = walk.resolveModuleBinding(closure.module, name);
  return moduleValue ? [moduleValue] : [];
};

/** Whether a closure declares `name` itself (a parameter or local), so the name never reaches its captured scope. */
export const isClosureLocal = (closure: StaticFunctionValue, name: string): boolean => {
  const shape = getClosureShape(closure.node);
  return shape.declaredNames.has(name) || shape.parameterNames.includes(name);
};

/** The identifier a path is ultimately read from, through the lists its bound items come from. */
export const getAccessRoot = (path: AccessPath, bindings: ItemBinding[]): string => {
  const [root] = path;
  const bindingIndex = bindings.findLastIndex((binding) => binding.name === root);
  return bindingIndex >= 0
    ? getAccessRoot(bindings[bindingIndex].receiver, bindings.slice(0, bindingIndex))
    : root;
};

const LIST_ITEMS_KEY = "items";

const getItemValues = (values: StaticValue[], record: RecordDependency): StaticValue[] =>
  values.flatMap((value) => {
    switch (value.kind) {
      case "list":
        record(value, LIST_ITEMS_KEY);
        return getItemValues(value.items, record);
      case "branch":
        return getItemValues(value.alternatives, record);
      case "optional":
        return getItemValues([value.value], record);
      case "repeat":
        return getItemValues([value.item], record);
      default:
        return [value];
    }
  });

const getMemberValues = (
  values: StaticValue[],
  key: string,
  record: RecordDependency,
): StaticValue[] =>
  values.flatMap((value) => {
    switch (value.kind) {
      case "object":
        record(value, key);
        return [getObjectProperty(value, key)];
      case "function": {
        record(value, key);
        const property = value.properties.get(key);
        return property ? [property] : [];
      }
      case "branch":
        return getMemberValues(value.alternatives, key, record);
      case "optional":
        return getMemberValues([value.value], key, record);
      default:
        return [];
    }
  });

/**
 * The values a path names inside an escaped closure; several when a member is
 * read off a branch. Every member read is recorded as a dependency of the
 * closure so its walk is redone when that member changes.
 */
export const resolveAccessPath = (
  closure: StaticFunctionValue,
  frame: EscapeFrame | null,
  path: AccessPath,
  walk: EscapeWalk,
  bindings: ItemBinding[],
): StaticValue[] => {
  const record: RecordDependency = (dependency, key) =>
    walk.memo.addDependency(closure, dependency, key);
  const [root, ...members] = path;
  const thisValue = closure.thisValue ?? closure.boundThis;
  let values =
    root === "this"
      ? thisValue
        ? [thisValue]
        : []
      : resolveEscapedIdentifier(closure, frame, root, bindings, walk, record);
  for (const member of members) {
    const keys =
      typeof member === "string"
        ? [member]
        : resolveAccessPath(closure, frame, member.keyPath, walk, bindings).flatMap((key) =>
            key.kind === "primitive" &&
            (typeof key.value === "string" || typeof key.value === "number")
              ? [String(key.value)]
              : [],
          );
    values = keys.flatMap((key) => getMemberValues(values, key, record));
  }
  return values;
};

const bindArguments = (
  callee: StaticFunctionValue,
  argumentValues: EscapeArguments,
): EscapeFrame => {
  const parameters = new Map<string, StaticValue>();
  getClosureShape(callee.node).parameterNames.forEach((name, index) => {
    const value = argumentValues[index];
    if (name !== null && value) parameters.set(name, value);
  });
  return { arguments: [...argumentValues], parameters };
};

/**
 * Visits the callables reachable from a value that flows into code the
 * evaluator cannot follow, since they may run at any time after mount.
 * Objects escape with everything they hold. A closure escapes with the
 * callables its body invokes: resolved callees are followed with their
 * arguments bound, while values handed to callees the walk cannot resolve
 * escape as callables only (see `forEachHandedCallable`). A closure held by an
 * escaping object or list is a method its consumer calls on a receiver of its
 * own choosing, so it escapes as a callee rather than directly. Closures whose
 * walk went stale since are followed again first.
 */
export const forEachEscapedCallable = (value: StaticValue, walk: EscapeWalk): void => {
  const visits: EscapeVisits = { escaped: new Set(), handed: new Set() };
  followStaleCallables(walk, visits);
  visitEscapedValue(value, walk, visits);
};

/** Follows again the escaped closures whose walk went stale, as their code may run at any time. */
export const followStaleCallables = (
  walk: EscapeWalk,
  visits: EscapeVisits = { escaped: new Set(), handed: new Set() },
): void => {
  for (const [closure, tuples] of walk.memo.takeStale()) {
    for (const tuple of tuples) invokeOnce(closure, tuple, walk, visits);
  }
};

const visitEscapedValue = (value: StaticValue, walk: EscapeWalk, visits: EscapeVisits): void => {
  if (value.kind === "function") {
    invokeOnce(value, null, walk, visits);
    return;
  }
  if (visits.escaped.has(value)) return;
  visits.escaped.add(value);
  switch (value.kind) {
    case "native-function":
      walk.visit(value, null);
      return;
    case "object":
      for (const entry of value.entries) visitHeldValue(entry.value, walk, visits);
      return;
    case "list":
      for (const item of value.items) visitHeldValue(item, walk, visits);
      return;
    case "branch":
      for (const alternative of value.alternatives) {
        visitEscapedValue(alternative, walk, visits);
      }
      return;
    case "optional":
    case "repeat":
      visitEscapedValue(value.kind === "optional" ? value.value : value.item, walk, visits);
      return;
    default:
      return;
  }
};

const UNKNOWN_CALLEE_ARGUMENTS: EscapeArguments = [];

const visitHeldValue = (value: StaticValue, walk: EscapeWalk, visits: EscapeVisits): void => {
  if (value.kind === "function") {
    invokeOnce(value, UNKNOWN_CALLEE_ARGUMENTS, walk, visits);
    return;
  }
  visitEscapedValue(value, walk, visits);
};

/**
 * A closure is followed once per distinct argument tuple, so a helper invoked
 * with several callbacks is followed for each while a cycle, which rebinds the
 * same values, terminates. A closure that escaped directly has no tuple.
 */
const invokeOnce = (
  closure: StaticFunctionValue,
  argumentValues: EscapeTuple,
  walk: EscapeWalk,
  visits: EscapeVisits,
): void => {
  if (!walk.memo.follow(closure, argumentValues)) return;
  forEachInvokedCallable(
    closure,
    argumentValues === null ? null : bindArguments(closure, argumentValues),
    walk,
    visits,
  );
};

/**
 * A value handed to a callee the walk cannot resolve is usually analyzed code
 * whose receiver was a local (`listeners.add(listener)`): the callables it
 * may invoke are the value itself and the items of a list, not the members of
 * an object. Objects are addressed by name in that code, and enumerating them
 * would treat every closure stored anywhere inside a stateful instance (an
 * editor, a store) as running. A handed list is a dependency of the closure: a
 * listener pushed into it later must be reached too.
 */
const forEachHandedCallable = (
  value: StaticValue,
  walk: EscapeWalk,
  visits: EscapeVisits,
  record: RecordDependency,
): void => {
  if (value.kind === "native-function" || value.kind === "function") {
    visitEscapedValue(value, walk, visits);
    return;
  }
  if (visits.handed.has(value)) return;
  visits.handed.add(value);
  switch (value.kind) {
    case "list":
      record(value, LIST_ITEMS_KEY);
      for (const item of value.items) forEachHandedCallable(item, walk, visits, record);
      return;
    case "branch":
      for (const alternative of value.alternatives) {
        forEachHandedCallable(alternative, walk, visits, record);
      }
      return;
    case "optional":
    case "repeat":
      forEachHandedCallable(
        value.kind === "optional" ? value.value : value.item,
        walk,
        visits,
        record,
      );
      return;
    default:
      return;
  }
};

const forEachInvokedCallable = (
  closure: StaticFunctionValue,
  frame: EscapeFrame | null,
  walk: EscapeWalk,
  visits: EscapeVisits,
): void => {
  walk.visit(closure, frame);
  const record: RecordDependency = (dependency, key) =>
    walk.memo.addDependency(closure, dependency, key);
  for (const callSite of getClosureShape(closure.node).callSites) {
    const resolve = (path: AccessPath): StaticValue[] =>
      resolveAccessPath(closure, frame, path, walk, callSite.bindings);
    const handPaths = (paths: AccessPath[]): void => {
      for (const path of paths) {
        for (const value of resolve(path)) forEachHandedCallable(value, walk, visits, record);
      }
    };
    const argumentValues = callSite.arguments.map(({ path, literal }) => {
      if (literal) return literal;
      const [value, ...others] = path ? resolve(path) : [];
      return value && others.length === 0 ? value : null;
    });
    const callees = callSite.callee ? resolve(callSite.callee) : [];
    const isEveryCalleeFollowed =
      callees.length > 0 && callees.every((callee) => callee.kind === "function");
    for (const callee of callees) {
      switch (callee.kind) {
        case "native-function":
          walk.visit(callee, { arguments: argumentValues, parameters: new Map() });
          break;
        case "function":
          invokeOnce(callee, argumentValues, walk, visits);
          break;
        default:
          forEachHandedCallable(callee, walk, visits, record);
      }
    }
    handPaths(callSite.nestedPaths);
    if (isEveryCalleeFollowed) continue;
    handPaths(callSite.arguments.flatMap(({ path }) => (path ? [path] : [])));
    if (callSite.callee && callSite.callee.length > 1)
      handPaths([getReceiverPath(callSite.callee)]);
  }
};
