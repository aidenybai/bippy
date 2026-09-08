import type { Expression, Node } from "oxc-parser";
import type {
  FunctionLikeNode,
  StaticNativeFunctionValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";
import { isCompilerHelperPackage } from "../graph/helper-packages.js";
import { hasExportedName } from "../graph/module-record.js";
import { getBuiltinGlobal, getTypeofValue } from "./builtin-calls.js";
import {
  getObjectProperty,
  getTruthiness,
  isKnownList,
  listValue,
  objectValue,
  omitObjectKeys,
  primitiveValue,
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

/** Whether a module namespace behaves as an ES module to interop helpers. */
export const isEsModuleLike = (value: StaticValue): boolean => {
  if (value.kind === "namespace") {
    return !value.module.isCommonJs || hasExportedName(value.module, "__esModule");
  }
  if (value.kind === "external") return true;
  if (value.kind === "object")
    return getTruthiness(getObjectProperty(value, "__esModule")) === true;
  return false;
};

const interopRequireDefault: HelperImplementation = ([moduleValue]) => {
  if (!moduleValue) return UNDEFINED_VALUE;
  if (isEsModuleLike(moduleValue)) return moduleValue;
  return objectValue([{ kind: "property", key: "default", value: moduleValue }]);
};

const interopRequireWildcard: HelperImplementation = ([moduleValue]) => {
  if (!moduleValue) return UNDEFINED_VALUE;
  if (isEsModuleLike(moduleValue)) return moduleValue;
  return objectValue([
    { kind: "spread", value: moduleValue },
    { kind: "property", key: "default", value: moduleValue },
  ]);
};

const assign: HelperImplementation = (args, tools) => {
  const objectAssign = getBuiltinGlobal("Object.assign");
  return objectAssign ? tools.call(objectAssign, args) : unknownValue("Object.assign helper");
};

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

const objectWithoutProperties: HelperImplementation = ([source, excluded]) => {
  if (!source || !excluded) return source ?? UNDEFINED_VALUE;
  if (source.kind !== "object" || !isKnownList(excluded)) {
    return unknownValue("rest of a non-object");
  }
  const omitted = new Set<string>();
  for (const key of excluded.items) {
    if (key.kind !== "primitive") return unknownValue("rest with dynamic excluded keys");
    omitted.add(String(key.value));
  }
  return omitObjectKeys(source, omitted);
};

const defineProperty: HelperImplementation = ([target, key, value]) => {
  if (!target) return UNDEFINED_VALUE;
  if (target.kind === "object" && key?.kind === "primitive" && value) {
    target.entries.push({ kind: "property", key: String(key.value), value });
  }
  return target;
};

const typeOf: HelperImplementation = ([value]) =>
  value ? getTypeofValue(value, null) : primitiveValue("undefined");

const HELPERS: Record<string, HelperImplementation> = {
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
  taggedTemplateLiteral: identity,
  _tagged_template_literal: identity,
  classCallCheck: () => UNDEFINED_VALUE,
  _class_call_check: () => UNDEFINED_VALUE,
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
  const named = functionName.startsWith("_")
    ? (HELPERS[functionName] ?? HELPERS[functionName.slice(1)])
    : undefined;
  const implementation = named ?? (isEsbuildToEsm(node) ? interopRequireWildcard : undefined);
  return implementation
    ? { kind: "native-function", name: functionName, call: implementation }
    : null;
};

/** The modeled compiler helper an import resolves to, if it is one. */
export const getCompilerHelper = (
  packageName: string,
  specifier: string,
  importedName: string,
): StaticNativeFunctionValue | null => {
  if (!isCompilerHelperPackage(packageName)) return null;
  const name = getHelperName(packageName, specifier, importedName);
  const implementation = HELPERS[name];
  if (!implementation) return null;
  return { kind: "native-function", name, call: implementation };
};
