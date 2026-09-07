import type { Argument, CallExpression, Expression } from "@oxc-project/types";
import { getReactApiReference } from "../link/react-api.js";
import {
  getMemberChain,
  isCallExpression,
  isNodeOfType,
  isStaticMemberExpression,
  unwrapExpression,
  walk,
} from "../module/ast.js";
import type { SourceLocation } from "../module/location.js";
import type { ParsedModule } from "../module/types.js";
import type { EvaluationContext, Interpreter } from "./interpreter.js";
import type { StaticValue } from "./values.js";

/**
 * The react-dom call that hands an element tree to a root: `createRoot(el)
 * .render(x)`, `hydrateRoot(el, x)` or the legacy `ReactDOM.render(x, el)`.
 */
export type MountApi = "createRoot" | "hydrateRoot" | "render";

export interface MountPoint {
  api: MountApi;
  /** The element tree the root renders. */
  element: StaticValue;
  location: SourceLocation;
}

const ROOT_FACTORIES: ReadonlySet<string> = new Set<MountApi>(["createRoot", "hydrateRoot"]);

/**
 * The react-dom API a callee names, if any. Only chains rooted in a
 * module-level binding qualify: react-dom arrives through imports, and
 * evaluating locals of nested functions in module scope would resolve
 * nothing.
 */
const getReactDomApi = (
  interpreter: Interpreter,
  callee: Expression,
  module: ParsedModule,
  context: EvaluationContext,
): string | null => {
  const chain = getMemberChain(callee);
  if (chain === null || !module.bindings.has(chain[0])) return null;
  const value = interpreter.evaluateChain(chain, callee, context);
  if (value.kind !== "external") return null;
  const reference = getReactApiReference(value);
  return reference?.source === "react-dom" ? reference.api : null;
};

const isRootFactoryCall = (
  interpreter: Interpreter,
  expression: Expression,
  module: ParsedModule,
  context: EvaluationContext,
): boolean => {
  const unwrapped = unwrapExpression(expression);
  if (!isCallExpression(unwrapped)) return false;
  const api = getReactDomApi(interpreter, unwrapped.callee, module, context);
  return api !== null && ROOT_FACTORIES.has(api);
};

/**
 * Whether `expression` is a root: a `createRoot()` call or a module-level
 * binding initialised with one (`const root = createRoot(el)`).
 */
const isRoot = (
  interpreter: Interpreter,
  expression: Expression,
  module: ParsedModule,
  context: EvaluationContext,
): boolean => {
  const unwrapped = unwrapExpression(expression);
  if (isRootFactoryCall(interpreter, unwrapped, module, context)) return true;
  if (unwrapped.type !== "Identifier") return false;
  const binding = module.bindings.get(unwrapped.name);
  if (binding?.kind !== "declaration" || binding.node.type !== "VariableDeclarator") return false;
  return (
    binding.node.init !== null && isRootFactoryCall(interpreter, binding.node.init, module, context)
  );
};

const getElementArgument = (argument: Argument | undefined): Expression | null =>
  argument === undefined || argument.type === "SpreadElement" ? null : argument;

const classifyMountCall = (
  interpreter: Interpreter,
  call: CallExpression,
  module: ParsedModule,
  context: EvaluationContext,
): { api: MountApi; element: Expression } | null => {
  const callee = unwrapExpression(call.callee);
  if (
    isStaticMemberExpression(callee) &&
    callee.property.name === "render" &&
    isRoot(interpreter, callee.object, module, context)
  ) {
    const element = getElementArgument(call.arguments[0]);
    return element ? { api: "createRoot", element } : null;
  }
  const api = getReactDomApi(interpreter, callee, module, context);
  if (api === "hydrateRoot") {
    const element = getElementArgument(call.arguments[1]);
    return element ? { api, element } : null;
  }
  if (api === "render") {
    const element = getElementArgument(call.arguments[0]);
    return element ? { api, element } : null;
  }
  return null;
};

const collectCalls = (module: ParsedModule): CallExpression[] => {
  const calls: CallExpression[] = [];
  walk(module.program, (node) => {
    if (isNodeOfType(node, "CallExpression")) calls.push(node);
  });
  return calls;
};

/**
 * Finds the places a module hands elements to react-dom. Elements are
 * evaluated in module scope, which is where `createRoot(el).render(<App />)`
 * lives in practice; a mount inside a function still resolves the
 * module-level components it references.
 */
export const findMountPoints = (interpreter: Interpreter, module: ParsedModule): MountPoint[] => {
  const context = interpreter.createModuleContext(module);
  const mounts: MountPoint[] = [];
  for (const call of collectCalls(module)) {
    const mount = classifyMountCall(interpreter, call, module, context);
    if (!mount) continue;
    mounts.push({
      api: mount.api,
      element: interpreter.evaluateExpression(mount.element, context),
      location: interpreter.getLocation(module, call),
    });
  }
  return mounts;
};
