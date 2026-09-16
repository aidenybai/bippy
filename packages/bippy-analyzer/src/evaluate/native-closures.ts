import type { Node } from "oxc-parser";
import { forEachChildNode, isFunctionLikeExpression } from "../parse/ast-walk.js";
import { parseSourceText } from "../parse/parse-source-file.js";
import type {
  FunctionLikeNode,
  ModuleRecord,
  ParsedSourceFile,
  StaticClassValue,
  StaticFunctionValue,
  StaticValue,
} from "../types.js";
import {
  type CapturedBinding,
  inspectBoundFunction,
  inspectClosure,
} from "./closure-inspection.js";
import { createScope, declareInScope } from "./scope.js";
import { objectValue, setObjectProperty } from "./values.js";

export type LiftedCallable = StaticFunctionValue | StaticClassValue;

/**
 * A native function in the interpreter's terms: its source, which
 * `Function.prototype.toString` still has, closed over the variables V8 kept
 * for it. The engine reports what its debugger sees, so a function no source
 * file describes (`cva(...)`'s returned closure, a package's minified internals)
 * can be evaluated on symbolic arguments instead of running natively only on
 * known ones.
 */

/** Native values in the interpreter's terms, as `fromNativeValue` lifts them. */
export interface NativeValueLifter {
  (value: unknown, name: string): StaticValue;
}

const NATIVE_CODE_SOURCE = /\{\s*\[native code\]\s*\}\s*$/;
const EXPRESSION_SOURCE =
  /^(?:async\s+)?function\b|^\(|^async\s*\(|^(?:async\s+)?[A-Za-z_$][\w$]*\s*=>/;
const CLASS_SOURCE = /^class\b/;

/**
 * Function source as an expression statement: a method (`greet() {}`) only
 * parses as an object literal member, and a class is returned by a thunk, so
 * the interpreter defines it (its heritage, prototype and statics) the way it
 * defines the program's own classes.
 */
const toProgramText = (source: string): string => {
  if (CLASS_SOURCE.test(source)) return `(() => (${source}));`;
  return EXPRESSION_SOURCE.test(source) ? `(${source});` : `({ ${source} });`;
};

const findFunctionNode = (file: ParsedSourceFile): FunctionLikeNode | null => {
  const [statement] = file.program.body;
  if (statement?.type !== "ExpressionStatement") return null;
  const { expression } = statement;
  if (isFunctionLikeExpression(expression)) return expression;
  if (expression.type !== "ObjectExpression") return null;
  const [property] = expression.properties;
  return property?.type === "Property" && isFunctionLikeExpression(property.value)
    ? property.value
    : null;
};

/**
 * The identifier a lifted class extends, or null. The engine keeps a variable
 * in a closure only when a function reads it; a class read its parent once,
 * when it was defined, so the parent is taken from the class's own
 * `[[Prototype]]` instead.
 */
const getHeritageName = (thunk: FunctionLikeNode): string | null => {
  const classNode = thunk.body;
  return classNode?.type === "ClassExpression" && classNode.superClass?.type === "Identifier"
    ? classNode.superClass.name
    : null;
};

/** A native function's source, parsed: the function node and the names it may resolve from its closure. */
export interface NativeSource {
  file: ParsedSourceFile;
  node: FunctionLikeNode;
  identifiers: Set<string>;
  hasSuper: boolean;
  isClass: boolean;
}

const collectSourceNames = (node: Node, source: NativeSource): void => {
  if (node.type === "Identifier") source.identifiers.add(node.name);
  if (node.type === "Super") source.hasSuper = true;
  forEachChildNode(node, (child) => collectSourceNames(child, source));
};

const getSourceText = (callee: Function): string => Function.prototype.toString.call(callee).trim();

const sources = new WeakMap<Function, NativeSource | null>();

/** `callee`'s source parsed once; null for a function without one (native code, a bound function) or whose source does not parse. */
export const getNativeSource = (callee: Function, name: string): NativeSource | null => {
  const cached = sources.get(callee);
  if (cached !== undefined) return cached;
  const text = getSourceText(callee);
  let source: NativeSource | null = null;
  if (!NATIVE_CODE_SOURCE.test(text)) {
    const file = parseSourceText(`native-closure:${name}`, toProgramText(text), "js");
    const node = file.errors.length === 0 ? findFunctionNode(file) : null;
    if (node !== null) {
      source = {
        file,
        node,
        identifiers: new Set(),
        hasSuper: false,
        isClass: CLASS_SOURCE.test(text),
      };
      collectSourceNames(node, source);
    }
  }
  sources.set(callee, source);
  return source;
};

const capturedBindings = new WeakMap<Function, CapturedBinding[] | null>();

/**
 * The variables `callee` closed over that its source names, read once: the
 * captured objects keep one identity across everything the analysis does with
 * them, as they do natively. Null when the closure cannot be read.
 */
export const getCapturedBindings = (
  callee: Function,
  source: NativeSource,
): CapturedBinding[] | null => {
  const cached = capturedBindings.get(callee);
  if (cached !== undefined) return cached;
  const captured = inspectClosure(callee, (name) => source.identifiers.has(name));
  capturedBindings.set(callee, captured);
  return captured;
};

export const isClassSource = (value: unknown): value is Function =>
  typeof value === "function" && CLASS_SOURCE.test(getSourceText(value));

const createSyntheticModule = (file: ParsedSourceFile): ModuleRecord => ({
  filePath: file.filePath,
  file,
  directives: [],
  imports: [],
  exports: [],
  bindings: new Map(),
  dependencies: [],
  sideEffectStatements: [],
  outParameterBindings: [],
  isCommonJs: false,
  moduleExports: null,
  moduleExportsMembers: [],
});

/**
 * Whether the analysis knows what kind of value this is (its `typeof`; for a
 * list, that it is an array), whatever its contents. A library dispatches on
 * the kind of its subject, the first argument, before it reads the rest, so on
 * a subject of unknown kind every dispatch forks and the result says nothing
 * about the program's inputs; an opaque subject is left to yield an opaque
 * result.
 */
export const hasKnownKind = (value: StaticValue): boolean => {
  switch (value.kind) {
    case "unknown":
    case "external":
      return false;
    case "unknown-primitive":
      return value.primitiveType !== "any";
    case "branch":
      return value.alternatives.every(hasKnownKind);
    case "optional":
      return hasKnownKind(value.value);
    default:
      return true;
  }
};

/** Evaluates a thunk the lift built, `() => class ...`, to the class it defines. */
export interface ClassThunkEvaluator {
  (thunk: StaticFunctionValue): StaticValue;
}

const lifted = new WeakMap<Function, LiftedCallable | null>();

/** A bound function as its target over the receiver and leading arguments `bind` fixed. */
const liftBoundFunction = (
  callee: Function,
  name: string,
  lift: NativeValueLifter,
  defineClass: ClassThunkEvaluator,
): StaticFunctionValue | null => {
  const bound = inspectBoundFunction(callee);
  if (bound === null) return null;
  const target = liftNativeClosure(bound.target, name, lift, defineClass);
  if (target === null || target.kind !== "function") return null;
  return {
    ...target,
    boundThis: lift(bound.boundThis, `${name}.this`),
    boundArgs: bound.boundArgs.map((argument, index) => lift(argument, `${name}[${index}]`)),
  };
};

/**
 * A captured class as the interpreter's own, so a lifted class that extends
 * it inherits its members and `instanceof` decides against it; any other
 * captured value as `lift` reads it.
 */
const liftCaptured = (
  value: unknown,
  name: string,
  lift: NativeValueLifter,
  defineClass: ClassThunkEvaluator,
): StaticValue =>
  (isClassSource(value) ? liftNativeClosure(value, name, lift, defineClass) : null) ??
  lift(value, name);

const liftClosure = (
  callee: Function,
  name: string,
  lift: NativeValueLifter,
  defineClass: ClassThunkEvaluator,
): LiftedCallable | null => {
  const source = getNativeSource(callee, name);
  if (source === null) return liftBoundFunction(callee, name, lift, defineClass);
  const { file, node, isClass } = source;
  if (source.hasSuper && !isClass) return null;
  const captured = getCapturedBindings(callee, source);
  if (captured === null) return null;
  const scope = createScope(null);
  for (const binding of captured) {
    declareInScope(
      scope,
      binding.name,
      liftCaptured(binding.value, `${name}.${binding.name}`, lift, defineClass),
    );
  }
  const heritage = isClass ? getHeritageName(node) : null;
  if (heritage !== null && !scope.bindings.has(heritage)) {
    declareInScope(
      scope,
      heritage,
      liftCaptured(Object.getPrototypeOf(callee), `${name}.${heritage}`, lift, defineClass),
    );
  }
  const functionValue: StaticFunctionValue = {
    kind: "function",
    node,
    scope,
    module: createSyntheticModule(file),
    thisValue: null,
    superBinding: null,
    name: callee.name || null,
    properties: objectValue(),
  };
  if (isClass) {
    const classValue = defineClass(functionValue);
    return classValue.kind === "class" ? classValue : null;
  }
  const prototype: unknown = Object.getOwnPropertyDescriptor(callee, "prototype")?.value;
  if (typeof prototype === "object" && prototype !== null) {
    const liftedPrototype = lift(prototype, `${name}.prototype`);
    if (liftedPrototype.kind === "object") {
      setObjectProperty(liftedPrototype, "constructor", functionValue);
    }
    setObjectProperty(functionValue.properties, "prototype", liftedPrototype);
  }
  return functionValue;
};

/**
 * `callee` as an interpreter function or class over its captured variables (a
 * bound function as its target over what `bind` fixed), or null when it has
 * no source or its closure cannot be read. One lift per function: the closure
 * is read once and its captured objects keep one identity across calls, as
 * they do natively, and a class is defined once so `instanceof` agrees across
 * the instances it constructs. A class reached again while it is being
 * defined (two classes naming each other) is left to `lift`.
 */
export const liftNativeClosure = (
  callee: Function,
  name: string,
  lift: NativeValueLifter,
  defineClass: ClassThunkEvaluator,
): LiftedCallable | null => {
  const cached = lifted.get(callee);
  if (cached !== undefined) return cached;
  lifted.set(callee, null);
  const value = liftClosure(callee, name, lift, defineClass);
  lifted.set(callee, value);
  return value;
};
