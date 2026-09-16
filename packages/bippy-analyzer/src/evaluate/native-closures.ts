import type { Node } from "oxc-parser";
import { forEachChildNode, isFunctionLikeExpression } from "../parse/ast-walk.js";
import { parseSourceText } from "../parse/parse-source-file.js";
import type {
  FunctionLikeNode,
  ModuleRecord,
  ParsedSourceFile,
  StaticFunctionValue,
  StaticValue,
} from "../types.js";
import { inspectBoundFunction, inspectClosure } from "./closure-inspection.js";
import { createScope, declareInScope } from "./scope.js";
import { objectValue, setObjectProperty } from "./values.js";

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

/** Function source as an expression statement: a method (`greet() {}`) only parses as an object literal member. */
const toProgramText = (source: string): string | null => {
  const trimmed = source.trim();
  if (CLASS_SOURCE.test(trimmed)) return null;
  return EXPRESSION_SOURCE.test(trimmed) ? `(${trimmed});` : `({ ${trimmed} });`;
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

interface SourceNames {
  identifiers: Set<string>;
  hasSuper: boolean;
}

const collectSourceNames = (node: Node, names: SourceNames): void => {
  if (node.type === "Identifier") names.identifiers.add(node.name);
  if (node.type === "Super") names.hasSuper = true;
  forEachChildNode(node, (child) => collectSourceNames(child, names));
};

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

const lifted = new WeakMap<Function, StaticFunctionValue | null>();

/** A bound function as its target over the receiver and leading arguments `bind` fixed. */
const liftBoundFunction = (
  callee: Function,
  name: string,
  lift: NativeValueLifter,
): StaticFunctionValue | null => {
  const bound = inspectBoundFunction(callee);
  if (bound === null) return null;
  const target = liftNativeClosure(bound.target, name, lift);
  if (target === null) return null;
  return {
    ...target,
    boundThis: lift(bound.boundThis, `${name}.this`),
    boundArgs: bound.boundArgs.map((argument, index) => lift(argument, `${name}[${index}]`)),
  };
};

const liftClosure = (
  callee: Function,
  name: string,
  lift: NativeValueLifter,
): StaticFunctionValue | null => {
  const source = Function.prototype.toString.call(callee);
  if (NATIVE_CODE_SOURCE.test(source)) return liftBoundFunction(callee, name, lift);
  const programText = toProgramText(source);
  if (programText === null) return null;
  const file = parseSourceText(`native-closure:${name}`, programText, "js");
  const node = file.errors.length === 0 ? findFunctionNode(file) : null;
  if (node === null) return null;
  const names: SourceNames = { identifiers: new Set(), hasSuper: false };
  collectSourceNames(node, names);
  if (names.hasSuper) return null;
  const captured = inspectClosure(callee);
  if (captured === null) return null;
  const scope = createScope(null);
  for (const binding of captured) {
    if (!names.identifiers.has(binding.name)) continue;
    declareInScope(scope, binding.name, lift(binding.value, `${name}.${binding.name}`));
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
 * `callee` as an interpreter function over its captured variables (a bound
 * function as its target over what `bind` fixed), or null when it has no
 * source, is a class, or its closure cannot be read. One lift per function: the closure is read once and
 * its captured objects keep one identity across calls, as they do natively.
 */
export const liftNativeClosure = (
  callee: Function,
  name: string,
  lift: NativeValueLifter,
): StaticFunctionValue | null => {
  const cached = lifted.get(callee);
  if (cached !== undefined) return cached;
  const value = liftClosure(callee, name, lift);
  lifted.set(callee, value);
  return value;
};
