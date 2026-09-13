import type { Expression, Node } from "oxc-parser";
import type {
  FunctionLikeNode,
  StaticNativeFunctionValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";
import { nativeFunction } from "./stubs.js";
import { isBabelRuntimePackage, isCompilerHelperPackage } from "../graph/helper-packages.js";
import { hasExportedName } from "../graph/module-record.js";
import { isFunctionLikeExpression } from "../parse/ast-walk.js";
import { getBuiltinGlobal, getTypeofValue } from "./builtin-calls.js";
import { getCollectionItems } from "./collections.js";
import {
  chainPromise,
  createPromiseValue,
  getModeledPromise,
  isPossiblyUnsettled,
} from "./promises.js";
import { regeneratorRuntime } from "./regenerator.js";
import { getThrowCertainty } from "./thrown.js";
import {
  createSymbolValue,
  describeValue,
  FALSE_VALUE,
  getObjectProperty,
  getSymbolPropertyKey,
  getTruthiness,
  isKnownList,
  isNullish,
  listValue,
  mapValue,
  objectFromRecord,
  objectValue,
  omitRestKeys,
  primitiveValue,
  thrownValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

/**
 * Runtime helpers emitted by Babel (`@babel/runtime/helpers/*`), TypeScript
 * (`tslib`) and SWC (`@swc/helpers`) into compiled package output.
 */
interface HelperImplementation {
  (args: StaticValue[], tools: StubRenderTools): StaticValue;
}

const readEsModuleFlag = (value: StaticValue, tools: StubRenderTools | null): StaticValue => {
  switch (value.kind) {
    case "object":
      return getObjectProperty(value, "__esModule");
    case "proxy": {
      const trap = getObjectProperty(value.handler, "get");
      if (isNullish(trap) === true) return readEsModuleFlag(value.target, tools);
      return tools
        ? tools.call(trap, [value.target, primitiveValue("__esModule"), value])
        : UNDEFINED_VALUE;
    }
    default:
      return UNDEFINED_VALUE;
  }
};

/** Whether a module namespace behaves as an ES module to interop helpers. */
export const isEsModuleLike = (value: StaticValue, tools: StubRenderTools | null): boolean => {
  if (value.kind === "namespace") {
    return !value.module.isCommonJs || hasExportedName(value.module, "__esModule");
  }
  if (value.kind === "external") return true;
  return getTruthiness(readEsModuleFlag(value, tools)) === true;
};

const interopRequireDefault: HelperImplementation = ([moduleValue], tools) => {
  if (!moduleValue) return UNDEFINED_VALUE;
  if (isEsModuleLike(moduleValue, tools)) return moduleValue;
  return objectValue([{ kind: "property", key: "default", value: moduleValue }]);
};

const interopRequireWildcard: HelperImplementation = ([moduleValue], tools) => {
  if (!moduleValue) return UNDEFINED_VALUE;
  if (isEsModuleLike(moduleValue, tools)) return moduleValue;
  return objectValue([
    { kind: "spread", value: moduleValue },
    { kind: "property", key: "default", value: moduleValue },
  ]);
};

const callGlobal = (name: string, args: StaticValue[], tools: StubRenderTools): StaticValue => {
  const global = getBuiltinGlobal(name, tools.realm, null);
  return global ? tools.call(global, args) : unknownValue(`${name} helper`);
};

const assign: HelperImplementation = (args, tools) => callGlobal("Object.assign", args, tools);

const getPrototypeOf: HelperImplementation = (args, tools) =>
  callGlobal("Object.getPrototypeOf", args, tools);

const possibleConstructorReturn: HelperImplementation = ([self, call]) => {
  if (!self) return UNDEFINED_VALUE;
  if (!call || call.kind === "primitive") return self;
  return call;
};

/**
 * `super(...)` as Babel lowers it: `_callSuper(this, Derived, args)` and
 * `_createSuper(Derived)` construct the parent through `Reflect.construct`
 * from the derived constructor, whose `this` the interpreter is constructing.
 */
const constructParent = (
  derived: StaticValue,
  constructArguments: StaticValue,
  tools: StubRenderTools,
): StaticValue =>
  callGlobal(
    "Reflect.construct",
    [getPrototypeOf([derived], tools), constructArguments, derived],
    tools,
  );

const callSuper: HelperImplementation = ([self, derived, constructArguments], tools) =>
  self && derived
    ? possibleConstructorReturn(
        [self, constructParent(derived, constructArguments ?? listValue([]), tools)],
        tools,
      )
    : UNDEFINED_VALUE;

const createSuper: HelperImplementation = ([derived]) =>
  derived
    ? {
        kind: "native-function",
        name: "_createSuperInternal",
        call: (args, tools) => constructParent(derived, listValue(args), tools),
      }
    : UNDEFINED_VALUE;

const identity: HelperImplementation = ([value]) => value ?? UNDEFINED_VALUE;

const toArray: HelperImplementation = ([value]) => {
  if (!value) return UNDEFINED_VALUE;
  if (value.kind === "list" || value.kind === "repeat" || value.kind === "branch") return value;
  return unknownValue("array helper over non-array");
};

const spreadArray: HelperImplementation = ([target, source]) => {
  if (!target || !source) return target ?? UNDEFINED_VALUE;
  if (isKnownList(target) && isKnownList(source))
    return listValue([...target.items, ...source.items]);
  return unknownValue("spread of an indefinite array");
};

/** `null == source` yields `{}`; the excluded keys must be a literal list for the rest to be known. */
const objectWithoutProperties: HelperImplementation = ([source, excluded], tools) => {
  if (!source || !excluded) return source ?? UNDEFINED_VALUE;
  if (!isKnownList(excluded)) return unknownValue("rest with dynamic excluded keys");
  const omitted = new Set<string>();
  for (const key of excluded.items) {
    if (key.kind !== "primitive") return unknownValue("rest with dynamic excluded keys");
    omitted.add(String(key.value));
  }
  return mapValue(tools.materializeNamespace(source), (alternative) =>
    isNullish(alternative) === true ? objectValue() : omitRestKeys(alternative, omitted),
  );
};

const defineProperty: HelperImplementation = ([target, key, value], tools) => {
  if (!target) return UNDEFINED_VALUE;
  if (!key || !value) return target;
  const descriptor = objectValue([{ kind: "property", key: "value", value }]);
  return tools.call({ kind: "global", name: "Object.defineProperty" }, [target, key, descriptor]);
};

const toPropertyKey: HelperImplementation = ([key]) => {
  if (!key) return primitiveValue("undefined");
  if (key.kind === "symbol") return key;
  if (key.kind === "primitive" && typeof key.value !== "symbol") {
    return primitiveValue(String(key.value));
  }
  return unknownValue("property key of a dynamic value");
};

const typeOf: HelperImplementation = ([value], tools) =>
  value ? getTypeofValue(value, tools.realm) : primitiveValue("undefined");

/** A lowered class already carries its parent; a plain constructor function gets a prototype the analysis does not model. */
const inherits: HelperImplementation = ([subClass, superClass]) => {
  if (subClass?.kind === "function" && superClass) {
    subClass.properties.set(
      "prototype",
      unknownValue(`prototype inheriting from ${describeValue(superClass)}`),
    );
  }
  return UNDEFINED_VALUE;
};

/**
 * One `asyncGeneratorStep`: resumes the generator with the settled value, then
 * resolves the async result on `done` or waits on the yielded promise, as
 * `Promise.resolve(value).then(_next, _throw)` does.
 */
const stepAsyncGenerator = (
  generator: StaticValue,
  settle: { resolve: StaticValue; reject: StaticValue },
  key: "next" | "throw",
  arg: StaticValue,
  tools: StubRenderTools,
): StaticValue => {
  const resolveWith = (value: StaticValue): StaticValue => tools.call(settle.resolve, [value]);
  if (generator.kind !== "object") {
    return resolveWith(unknownValue(`async body over ${describeValue(generator)}`));
  }
  const result = tools.call(getObjectProperty(generator, key), [arg], generator);
  const certainty = getThrowCertainty(result);
  if (certainty === "always") {
    return tools.call(settle.reject, [
      result.kind === "unknown" && result.thrown ? result.thrown : result,
    ]);
  }
  if (certainty === "maybe") return resolveWith(unknownValue("async step that may throw"));
  if (result.kind !== "object") {
    return resolveWith(unknownValue(`async step yielding ${describeValue(result)}`));
  }
  const value = getObjectProperty(result, "value");
  const isDone = getTruthiness(getObjectProperty(result, "done"));
  if (isDone === null) return resolveWith(unknownValue("async step whose completion is uncertain"));
  if (isDone) return resolveWith(value);
  const next = nativeFunction("_next", ([settled], nextTools) =>
    stepAsyncGenerator(generator, settle, "next", settled ?? UNDEFINED_VALUE, nextTools),
  );
  const rethrow = nativeFunction("_throw", ([reason], throwTools) =>
    stepAsyncGenerator(generator, settle, "throw", reason ?? UNDEFINED_VALUE, throwTools),
  );
  const awaited = getModeledPromise(value);
  if (awaited) {
    chainPromise(awaited, { onFulfilled: next, onRejected: rethrow, onFinally: null }, tools, null);
  } else if (isPossiblyUnsettled(value)) {
    tools.callDeferred(next, [value]);
  } else {
    tools.queueMicrotask(() => tools.call(next, [value]));
  }
  return UNDEFINED_VALUE;
};

/** `_asyncToGenerator(fn)`: an async function whose body is the generator `fn` returns. */
const asyncToGenerator: HelperImplementation = ([generatorFunction]) =>
  generatorFunction
    ? {
        kind: "native-function",
        name: "_asyncToGenerator",
        call: (args, tools) =>
          createPromiseValue(
            nativeFunction("executor", ([resolve, reject], executorTools) =>
              stepAsyncGenerator(
                executorTools.call(generatorFunction, args),
                { resolve: resolve ?? UNDEFINED_VALUE, reject: reject ?? UNDEFINED_VALUE },
                "next",
                UNDEFINED_VALUE,
                executorTools,
              ),
            ),
            tools,
            null,
          ),
      }
    : UNDEFINED_VALUE;

const ITERATOR_POSITION_KEY = getSymbolPropertyKey(createSymbolValue("position"));

/** `_createForOfIteratorHelper(iterable)`: the `{ s, n, e, f }` stepper a lowered `for..of` drives. */
const createForOfIteratorHelper: HelperImplementation = ([iterable]) => {
  if (!iterable) return unknownValue("for..of over nothing");
  const items =
    iterable.kind === "primitive" && typeof iterable.value === "string"
      ? listValue([...iterable.value].map(primitiveValue))
      : (getCollectionItems(iterable) ?? iterable);
  if (!isKnownList(items)) return unknownValue(`for..of over ${describeValue(iterable)}`);
  const noop = nativeFunction("noop", () => UNDEFINED_VALUE);
  const iterator = objectFromRecord({
    [ITERATOR_POSITION_KEY]: primitiveValue(0),
    s: noop,
    n: nativeFunction("n", (_args, tools) => {
      const position = getObjectProperty(iterator, ITERATOR_POSITION_KEY);
      if (position.kind !== "primitive" || typeof position.value !== "number") {
        return unknownValue("for..of step at an uncertain position");
      }
      if (position.value >= items.items.length) return objectFromRecord({ done: TRUE_VALUE });
      tools.setProperty(iterator, ITERATOR_POSITION_KEY, primitiveValue(position.value + 1));
      return objectFromRecord({ done: FALSE_VALUE, value: items.items[position.value] });
    }),
    e: nativeFunction("e", ([error]) =>
      thrownValue("for..of body throws", error ?? UNDEFINED_VALUE),
    ),
    f: noop,
  });
  return iterator;
};

const HELPERS: Record<string, HelperImplementation> = {
  regeneratorRuntime: () => regeneratorRuntime(),
  asyncToGenerator,
  _async_to_generator: asyncToGenerator,
  createForOfIteratorHelper,
  _create_for_of_iterator_helper: createForOfIteratorHelper,
  typeof: typeOf,
  _type_of: typeOf,
  interopRequireDefault,
  __importDefault: interopRequireDefault,
  _interop_require_default: interopRequireDefault,
  interopRequireWildcard,
  __importStar: interopRequireWildcard,
  __toESM: interopRequireWildcard,
  _interop_require_wildcard: interopRequireWildcard,
  extends: assign,
  __assign: assign,
  _extends: assign,
  objectSpread: assign,
  objectSpread2: assign,
  _object_spread: assign,
  slicedToArray: identity,
  __read: identity,
  _sliced_to_array: identity,
  toConsumableArray: toArray,
  toArray,
  _to_consumable_array: toArray,
  __spreadArray: spreadArray,
  objectWithoutProperties,
  objectWithoutPropertiesLoose: objectWithoutProperties,
  __rest: objectWithoutProperties,
  _object_without_properties: objectWithoutProperties,
  defineProperty,
  _define_property: defineProperty,
  toPropertyKey,
  _to_property_key: toPropertyKey,
  taggedTemplateLiteral: identity,
  _tagged_template_literal: identity,
  classCallCheck: () => UNDEFINED_VALUE,
  _class_call_check: () => UNDEFINED_VALUE,
  assertThisInitialized: identity,
  _assert_this_initialized: identity,
  getPrototypeOf,
  _get_prototype_of: getPrototypeOf,
  setPrototypeOf: (args, tools) => callGlobal("Object.setPrototypeOf", args, tools),
  _set_prototype_of: (args, tools) => callGlobal("Object.setPrototypeOf", args, tools),
  isNativeReflectConstruct: () => TRUE_VALUE,
  _is_native_reflect_construct: () => TRUE_VALUE,
  possibleConstructorReturn,
  _possible_constructor_return: possibleConstructorReturn,
  callSuper,
  _call_super: callSuper,
  createSuper,
  _create_super: createSuper,
  inherits,
  _inherits: inherits,
};

const getHelperName = (packageName: string, specifier: string, importedName: string): string => {
  if (importedName !== "default" && importedName !== "*") return importedName;
  const subpath = specifier.slice(packageName.length + 1);
  return subpath.replace(/^(helpers\/)?(esm\/)?(_\/)?/, "").replace(/\.js$/, "");
};

const getReturnedExpression = (node: FunctionLikeNode): Expression | null => {
  const body = node.body;
  if (!body) return null;
  if (body.type !== "BlockStatement") return body;
  const [statement] = body.body;
  return statement?.type === "ReturnStatement" ? (statement.argument ?? null) : null;
};

const readsEsModuleFlag = (node: Node): boolean => {
  switch (node.type) {
    case "LogicalExpression":
      return readsEsModuleFlag(node.left) || readsEsModuleFlag(node.right);
    case "UnaryExpression":
      return readsEsModuleFlag(node.argument);
    case "MemberExpression":
      return (
        !node.computed && node.property.type === "Identifier" && node.property.name === "__esModule"
      );
    default:
      return false;
  }
};

/**
 * esbuild's `__toESM` by shape, since minifiers rename it:
 * `(mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {},
 *   __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", ...) : target, mod))`.
 */
const isEsbuildToEsm = (node: FunctionLikeNode): boolean => {
  if (node.params.length !== 3) return false;
  const body = getReturnedExpression(node);
  if (body?.type !== "SequenceExpression" || body.expressions.length !== 2) return false;
  const [assignment, copy] = body.expressions;
  if (assignment.type !== "AssignmentExpression" || copy.type !== "CallExpression") return false;
  const [converted] = copy.arguments;
  return converted?.type === "ConditionalExpression" && readsEsModuleFlag(converted.test);
};

/**
 * Babel inlines helpers as `function _name() {}` declarations when a package is
 * compiled without `@babel/runtime`, esbuild as `var __name = (...) => ...`;
 * their bodies are the same reflection-heavy code.
 */
export const getInlineCompilerHelper = (
  functionName: string,
  node: FunctionLikeNode,
): StaticNativeFunctionValue | null => {
  const helperName = functionName.replace(/\$\d+$/, "");
  const named = helperName.startsWith("_")
    ? (HELPERS[helperName] ?? HELPERS[helperName.slice(1)])
    : undefined;
  const implementation = named ?? (isEsbuildToEsm(node) ? interopRequireWildcard : undefined);
  return implementation
    ? { kind: "native-function", name: functionName, call: implementation }
    : null;
};

/**
 * The helper function in a `var __rest = (this && this.__rest) || function (s, e) {...}`
 * initializer, as tsc emits without `importHelpers`.
 */
export const getInlineHelperFunction = (init: Expression): FunctionLikeNode | null => {
  if (isFunctionLikeExpression(init)) return init;
  if (init.type !== "LogicalExpression" || init.operator !== "||") return null;
  return isFunctionLikeExpression(init.right) && readsThisMember(init.left) ? init.right : null;
};

const readsThisMember = (node: Expression): boolean => {
  if (node.type === "LogicalExpression" && node.operator === "&&") {
    return node.left.type === "ThisExpression" && readsThisMember(node.right);
  }
  return node.type === "MemberExpression" && node.object.type === "ThisExpression";
};

/** The modeled compiler helper an import resolves to, if it is one. */
export const getCompilerHelper = (
  packageName: string,
  specifier: string,
  importedName: string,
): StaticValue | null => {
  if (!isCompilerHelperPackage(packageName)) return null;
  if (specifier === `${packageName}/regenerator`) return regeneratorRuntime();
  const name = getHelperName(packageName, specifier, importedName);
  const implementation = HELPERS[name];
  if (!implementation) return null;
  const helper: StaticNativeFunctionValue = { kind: "native-function", name, call: implementation };
  if (isBabelRuntimePackage(packageName) && importedName !== "default") {
    helper.getOwnProperty = (key) => getBabelHelperModuleProperty(helper, key);
  }
  return helper;
};

/**
 * `@babel/runtime`'s CommonJS helper modules end in `module.exports = helper,
 * module.exports.__esModule = true, module.exports["default"] = module.exports`,
 * so `require(helper).default` is the helper itself.
 */
const getBabelHelperModuleProperty = (
  helper: StaticNativeFunctionValue,
  key: string,
): StaticValue | undefined => {
  if (key === "default") return helper;
  return key === "__esModule" ? TRUE_VALUE : undefined;
};
