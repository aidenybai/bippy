import type {
  BindingPattern,
  BindingRestElement,
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
import { findOwningScope } from "./scope.js";
import { getObjectProperty, primitiveValue } from "./values.js";

/** `this`, `editor`, `callbackRef.current`, `this.update`: a value named from inside a closure body. */
export type AccessPath = string[];

/**
 * An in-place mutation a closure body performs: `editor._dirty = true`
 * assigns `key` on the object at `target`, `obj[dynamic] = v` assigns an
 * unknown key, and `cache.set(k, v)` or `items.push(x)` calls a mutating method.
 */
export interface EscapedMutation {
  target: AccessPath;
  key: string | null;
  isMethodCall: boolean;
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
      const key = objectPath ? getStaticMemberKey(node) : null;
      return objectPath && key !== null ? [...objectPath, key] : null;
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

const collectClosureShape = (node: Node, shape: ClosureShape): void => {
  switch (node.type) {
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
  forEachChildNode(node, (child) => collectClosureShape(child, shape));
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
  collectClosureShape(functionNode, shape);
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

const getMemberMutation = (member: Node): EscapedMutation | null => {
  if (member.type !== "MemberExpression") return null;
  const target = getAccessPath(member.object);
  return target ? { target, key: getStaticMemberKey(member), isMethodCall: false } : null;
};

const getMutation = (node: Node): EscapedMutation | null => {
  switch (node.type) {
    case "CallExpression": {
      const callee = node.callee;
      if (callee.type !== "MemberExpression") return null;
      const method = callee.computed ? null : callee.property;
      if (method?.type !== "Identifier" || !MUTATING_METHODS.has(method.name)) return null;
      const target = getAccessPath(callee.object);
      return target ? { target, key: null, isMethodCall: true } : null;
    }
    case "AssignmentExpression":
      return getMemberMutation(node.left);
    case "UpdateExpression":
      return getMemberMutation(node.argument);
    case "UnaryExpression":
      return node.operator === "delete" ? getMemberMutation(node.argument) : null;
    default:
      return null;
  }
};

const collectMutations = (node: Node, mutations: EscapedMutation[]): void => {
  const mutation = getMutation(node);
  if (mutation) mutations.push(mutation);
  forEachChildNode(node, (child) => collectMutations(child, mutations));
};

const mutationsCache = new WeakMap<FunctionLikeNode, EscapedMutation[]>();

/** The in-place mutations a function (or a function nested in it) performs. */
export const getEscapedMutations = (functionNode: FunctionLikeNode): EscapedMutation[] => {
  const cached = mutationsCache.get(functionNode);
  if (cached) return cached;
  const mutations: EscapedMutation[] = [];
  collectMutations(functionNode, mutations);
  mutationsCache.set(functionNode, mutations);
  return mutations;
};

/**
 * The value an identifier names inside an escaped closure: an argument bound
 * along the escaped call chain, a captured variable, or a module binding.
 * Locals the closure declares itself hold values that only exist once it runs.
 */
const resolveEscapedIdentifier = (
  closure: StaticFunctionValue,
  frame: EscapeFrame | null,
  name: string,
  walk: EscapeWalk,
  record: RecordDependency,
): StaticValue | null => {
  const bound = frame?.parameters.get(name);
  if (bound) return bound;
  if (isClosureLocal(closure, name)) return null;
  const owner = findOwningScope(closure.scope, name);
  if (owner) {
    record(owner, name);
    return owner.bindings.get(name) ?? null;
  }
  record(closure.module, name);
  return walk.resolveModuleBinding(closure.module, name);
};

/** Whether a closure declares `name` itself (a parameter or local), so the name never reaches its captured scope. */
export const isClosureLocal = (closure: StaticFunctionValue, name: string): boolean => {
  const shape = getClosureShape(closure.node);
  return shape.declaredNames.has(name) || shape.parameterNames.includes(name);
};

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
): StaticValue[] => {
  const record: RecordDependency = (dependency, key) =>
    walk.memo.addDependency(closure, dependency, key);
  const [root, ...members] = path;
  const rootValue =
    root === "this"
      ? (closure.thisValue ?? closure.boundThis)
      : resolveEscapedIdentifier(closure, frame, root, walk, record);
  let values = rootValue ? [rootValue] : [];
  for (const member of members) values = getMemberValues(values, member, record);
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
  for (const [closure, tuples] of walk.memo.takeStale()) {
    for (const tuple of tuples) invokeOnce(closure, tuple, walk, visits);
  }
  visitEscapedValue(value, walk, visits);
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
 * editor, a store) as running.
 */
const forEachHandedCallable = (
  value: StaticValue,
  walk: EscapeWalk,
  visits: EscapeVisits,
): void => {
  if (value.kind === "native-function" || value.kind === "function") {
    visitEscapedValue(value, walk, visits);
    return;
  }
  if (visits.handed.has(value)) return;
  visits.handed.add(value);
  switch (value.kind) {
    case "list":
      for (const item of value.items) forEachHandedCallable(item, walk, visits);
      return;
    case "branch":
      for (const alternative of value.alternatives) {
        forEachHandedCallable(alternative, walk, visits);
      }
      return;
    case "optional":
    case "repeat":
      forEachHandedCallable(value.kind === "optional" ? value.value : value.item, walk, visits);
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
  const handPaths = (paths: AccessPath[]): void => {
    for (const path of paths) {
      for (const value of resolveAccessPath(closure, frame, path, walk)) {
        forEachHandedCallable(value, walk, visits);
      }
    }
  };
  for (const callSite of getClosureShape(closure.node).callSites) {
    const argumentValues = callSite.arguments.map(({ path, literal }) => {
      if (literal) return literal;
      const [value, ...others] = path ? resolveAccessPath(closure, frame, path, walk) : [];
      return value && others.length === 0 ? value : null;
    });
    const callees = callSite.callee ? resolveAccessPath(closure, frame, callSite.callee, walk) : [];
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
          forEachHandedCallable(callee, walk, visits);
      }
    }
    handPaths(callSite.nestedPaths);
    if (isEveryCalleeFollowed) continue;
    handPaths(callSite.arguments.flatMap(({ path }) => (path ? [path] : [])));
    if (callSite.callee && callSite.callee.length > 1) handPaths([callSite.callee.slice(0, -1)]);
  }
};
