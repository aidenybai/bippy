import type { Node } from "oxc-parser";
import type {
  FunctionLikeNode,
  StaticFunctionValue,
  StaticNativeFunctionValue,
  StaticValue,
} from "../types.js";
import { forEachChildNode } from "../parse/ast-walk.js";
import { lookupScope } from "./scope.js";
import { getObjectProperty } from "./values.js";

const MAX_ESCAPE_SCAN_DEPTH = 4;

const freeIdentifiersCache = new WeakMap<FunctionLikeNode, Set<string>>();

const collectIdentifiers = (node: Node, names: Set<string>): void => {
  if (node.type === "Identifier") {
    names.add(node.name);
    return;
  }
  if (node.type === "MemberExpression" && !node.computed) {
    collectIdentifiers(node.object, names);
    return;
  }
  if (node.type === "Property" && !node.computed && node.key.type === "Identifier") {
    collectIdentifiers(node.value, names);
    return;
  }
  forEachChildNode(node, (child) => collectIdentifiers(child, names));
};

const getFreeIdentifiers = (functionNode: FunctionLikeNode): Set<string> => {
  const cached = freeIdentifiersCache.get(functionNode);
  if (cached) return cached;
  const names = new Set<string>();
  collectIdentifiers(functionNode, names);
  freeIdentifiersCache.set(functionNode, names);
  return names;
};

const thisMembersCache = new WeakMap<FunctionLikeNode, Set<string> | null>();

const collectThisMembers = (node: Node, names: Set<string>): boolean => {
  if (node.type === "ThisExpression") return false;
  if (
    node.type === "MemberExpression" &&
    node.object.type === "ThisExpression" &&
    !node.computed &&
    node.property.type === "Identifier"
  ) {
    names.add(node.property.name);
    return true;
  }
  let isMemberAccessOnly = true;
  forEachChildNode(node, (child) => {
    if (!collectThisMembers(child, names)) isMemberAccessOnly = false;
  });
  return isMemberAccessOnly;
};

/** Members a method reads off `this`; null when `this` itself flows somewhere. */
const getThisMembers = (functionNode: FunctionLikeNode): Set<string> | null => {
  const cached = thisMembersCache.get(functionNode);
  if (cached !== undefined) return cached;
  const names = new Set<string>();
  const members = collectThisMembers(functionNode, names) ? names : null;
  thisMembersCache.set(functionNode, members);
  return members;
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

const getMutatedObjectName = (node: Node): string | null => {
  switch (node.type) {
    case "CallExpression": {
      const callee = node.callee;
      if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return null;
      const method = callee.computed ? null : callee.property;
      return method?.type === "Identifier" && MUTATING_METHODS.has(method.name)
        ? callee.object.name
        : null;
    }
    case "AssignmentExpression":
    case "UpdateExpression": {
      const target = node.type === "AssignmentExpression" ? node.left : node.argument;
      return target.type === "MemberExpression" && target.object.type === "Identifier"
        ? target.object.name
        : null;
    }
    case "UnaryExpression":
      return node.operator === "delete" &&
        node.argument.type === "MemberExpression" &&
        node.argument.object.type === "Identifier"
        ? node.argument.object.name
        : null;
    default:
      return null;
  }
};

const collectMutatedIdentifiers = (node: Node, names: Set<string>): void => {
  const name = getMutatedObjectName(node);
  if (name !== null) names.add(name);
  forEachChildNode(node, (child) => collectMutatedIdentifiers(child, names));
};

const mutatedIdentifiersCache = new WeakMap<FunctionLikeNode, Set<string>>();

/** Identifiers whose object a function (or a function nested in it) mutates in place: `cache.set(...)`, `state.count++`. */
export const getMutatedIdentifiers = (functionNode: FunctionLikeNode): Set<string> => {
  const cached = mutatedIdentifiersCache.get(functionNode);
  if (cached) return cached;
  const names = new Set<string>();
  collectMutatedIdentifiers(functionNode, names);
  mutatedIdentifiersCache.set(functionNode, names);
  return names;
};

/**
 * Visits the callables reachable from a value that flows into code the
 * evaluator cannot follow, since they may run at any time after mount.
 * Closures are scanned for the callables they close over.
 */
export const forEachEscapedCallable = (
  value: StaticValue,
  visit: (callable: StaticFunctionValue | StaticNativeFunctionValue) => void,
  visited: Set<StaticValue> = new Set(),
  depth = 0,
): void => {
  if (depth > MAX_ESCAPE_SCAN_DEPTH || visited.has(value)) return;
  visited.add(value);
  switch (value.kind) {
    case "native-function":
      visit(value);
      return;
    case "function": {
      visit(value);
      for (const name of getFreeIdentifiers(value.node)) {
        const bound = lookupScope(value.scope, name);
        if (bound) forEachEscapedCallable(bound, visit, visited, depth + 1);
      }
      const thisValue = value.thisValue;
      if (!thisValue) return;
      const members = getThisMembers(value.node);
      if (members === null || thisValue.kind !== "object") {
        forEachEscapedCallable(thisValue, visit, visited, depth + 1);
        return;
      }
      for (const name of members) {
        forEachEscapedCallable(getObjectProperty(thisValue, name), visit, visited, depth + 1);
      }
      return;
    }
    case "object":
      for (const entry of value.entries)
        forEachEscapedCallable(entry.value, visit, visited, depth + 1);
      return;
    case "list":
      for (const item of value.items) forEachEscapedCallable(item, visit, visited, depth + 1);
      return;
    case "branch":
      for (const alternative of value.alternatives)
        forEachEscapedCallable(alternative, visit, visited, depth + 1);
      return;
    case "optional":
    case "repeat":
      forEachEscapedCallable(
        value.kind === "optional" ? value.value : value.item,
        visit,
        visited,
        depth + 1,
      );
      return;
    default:
      return;
  }
};
