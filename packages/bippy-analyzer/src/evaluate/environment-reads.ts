import type { Expression, Node } from "oxc-parser";
import { forEachChildNode, getStaticMemberKey } from "../parse/ast-walk.js";
import { inspectBoundFunction } from "./closure-inspection.js";
import { getCapturedBindings, getNativeSource } from "./native-closures.js";

/**
 * Whether a native function reads the clock or randomness (`Date.now()`,
 * `new Date()`, `Math.random()`, ...), in its own source or in a function it
 * reaches through its closure. Run natively, such a function answers with the
 * analysis's own time or draw; evaluated by the interpreter over its models of
 * the clock and of `Math.random`, it answers with what the program's render
 * depends on.
 */

const NONDETERMINISTIC_MEMBERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Date", new Set(["now"])],
  ["Math", new Set(["random"])],
  ["performance", new Set(["now"])],
  ["crypto", new Set(["randomUUID", "getRandomValues"])],
]);

/** The reads as functions, reached through a closure that captured one under its own name (`nativeRandom = Math.random`). */
const NONDETERMINISTIC_INTRINSICS: ReadonlySet<unknown> = new Set([
  Date.now,
  Math.random,
  performance.now,
  crypto.randomUUID,
  crypto.getRandomValues,
]);

const GLOBAL_NAMES = [...NONDETERMINISTIC_MEMBERS.keys()];

type CapturedValues = ReadonlyMap<string, unknown>;

/**
 * The global an expression denotes: the name itself (`Date`), a member of any
 * object named after it (`root.Date`, `globalThis.Date`), or a captured
 * variable holding it (`nativeDate = Date`). A free name is taken for the
 * global even where a local could shadow it: the cost of the doubt is a lift
 * where a native run would have done.
 */
const getGlobalName = (expression: Expression, captured: CapturedValues): string | null => {
  if (expression.type === "MemberExpression") return getStaticMemberKey(expression);
  if (expression.type !== "Identifier") return null;
  if (!captured.has(expression.name)) return expression.name;
  const value = captured.get(expression.name);
  return GLOBAL_NAMES.find((name) => Reflect.get(globalThis, name) === value) ?? null;
};

const isNondeterministicRead = (node: Node, captured: CapturedValues): boolean => {
  switch (node.type) {
    case "MemberExpression": {
      const key = getStaticMemberKey(node);
      const globalName = getGlobalName(node.object, captured);
      return (
        key !== null &&
        globalName !== null &&
        NONDETERMINISTIC_MEMBERS.get(globalName)?.has(key) === true
      );
    }
    case "NewExpression":
    case "CallExpression":
      return node.arguments.length === 0 && getGlobalName(node.callee, captured) === "Date";
    default:
      return false;
  }
};

const isObjectLike = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function";

const readMember = (object: object, key: string): unknown => {
  try {
    return Reflect.get(object, key);
  } catch {
    return undefined;
  }
};

/** A function still to scan, named as the lift names it so both parse it under one name. */
interface ReachedFunction {
  callee: Function;
  name: string;
}

/** A function the source may call: a captured function, or a member read off a captured object (`_index.constructNow`). */
const getReachedFunction = (
  node: Node,
  captured: CapturedValues,
  name: string,
): ReachedFunction | null => {
  if (node.type === "Identifier") {
    const value = captured.get(node.name);
    return typeof value === "function" ? { callee: value, name: `${name}.${node.name}` } : null;
  }
  if (node.type !== "MemberExpression" || node.object.type !== "Identifier") return null;
  const key = getStaticMemberKey(node);
  const object = captured.get(node.object.name);
  if (key === null || !isObjectLike(object)) return null;
  const value = readMember(object, key);
  return typeof value === "function"
    ? { callee: value, name: `${name}.${node.object.name}.${key}` }
    : null;
};

/** Whether `node` reads the environment itself; the functions it may call are added to `reached`. */
const scanNode = (
  node: Node,
  captured: CapturedValues,
  name: string,
  reached: ReachedFunction[],
): boolean => {
  if (isNondeterministicRead(node, captured)) return true;
  const callee = getReachedFunction(node, captured, name);
  if (callee !== null) reached.push(callee);
  let reads = false;
  forEachChildNode(node, (child) => {
    reads ||= scanNode(child, captured, name, reached);
  });
  return reads;
};

const scanFunction = ({ callee, name }: ReachedFunction, reached: ReachedFunction[]): boolean => {
  const source = getNativeSource(callee, name);
  if (source === null) {
    const target = inspectBoundFunction(callee)?.target;
    if (target !== undefined) reached.push({ callee: target, name });
    return false;
  }
  const captured = new Map(
    (getCapturedBindings(callee, source) ?? []).map((binding) => [binding.name, binding.value]),
  );
  if (source.isClass) {
    const parent: unknown = Object.getPrototypeOf(callee);
    if (typeof parent === "function") reached.push({ callee: parent, name });
  }
  return scanNode(source.node, captured, name, reached);
};

/** Functions the interpreter runs itself, whose reads it models: they are not scanned. */
export interface InterpretedFunctionPredicate {
  (callee: Function): boolean;
}

const environmentReads = new WeakMap<Function, boolean>();

export const readsEnvironment = (
  callee: Function,
  name: string,
  isInterpreted: InterpretedFunctionPredicate = () => false,
): boolean => {
  const cached = environmentReads.get(callee);
  if (cached !== undefined) return cached;
  const visited = new Set<Function>();
  const pending: ReachedFunction[] = [{ callee, name }];
  let reads = false;
  while (!reads) {
    const next = pending.pop();
    if (next === undefined) break;
    if (visited.has(next.callee) || isInterpreted(next.callee)) continue;
    visited.add(next.callee);
    reads = NONDETERMINISTIC_INTRINSICS.has(next.callee) || scanFunction(next, pending);
  }
  environmentReads.set(callee, reads);
  return reads;
};
