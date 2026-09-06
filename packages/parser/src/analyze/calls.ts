import type { Argument, CallExpression, Expression } from "@oxc-project/types";
import { getReactApiReference } from "../link/react-api.js";
import { getMemberChain, isStringLiteral, unwrapExpression } from "../module/ast.js";
import { getProperty, spreadInto } from "./access.js";
import { evaluateArrayMethod, evaluateGlobalCall, evaluateStringMethod, GLOBAL_NAMESPACES } from "./builtins.js";
import { readContext } from "./contexts.js";
import { isBuiltinHookName, modelBuiltinHook } from "./hooks.js";
import { type EvaluationContext, getReturnValue, type Interpreter } from "./interpreter.js";
import { isHookCallee, isHookName } from "./naming.js";
import { bindParameters } from "./patterns.js";
import { type CallbackInvoker, evaluateReactCall } from "./react-calls.js";
import { createScope, hasLocalBinding } from "./scope.js";
import {
  type ExternalValue,
  type FunctionValue,
  type StaticValue,
  text,
  UNDEFINED,
  unknown,
} from "./values.js";

const evaluateArguments = (
  interpreter: Interpreter,
  callArguments: Argument[],
  context: EvaluationContext,
): StaticValue[] => {
  const values: StaticValue[] = [];
  for (const argument of callArguments) {
    if (argument.type === "SpreadElement") {
      spreadInto(values, interpreter.evaluateExpression(argument.argument, context));
    } else values.push(interpreter.evaluateExpression(argument, context));
  }
  return values;
};

const createInvoker =
  (interpreter: Interpreter, context: EvaluationContext): CallbackInvoker =>
  (callback, callArguments) => {
    if (callback.kind === "function") {
      return interpreter.callFunction(callback, callArguments, context);
    }
    return unknown(`call of ${callback.kind}`);
  };

const isReactHook = (callee: StaticValue): callee is ExternalValue => {
  if (callee.kind !== "external") return false;
  const reference = getReactApiReference(callee);
  return reference !== null && reference.source === "react" && isHookName(reference.api);
};

const isGlobalChain = (chain: string[], context: EvaluationContext): boolean =>
  GLOBAL_NAMESPACES.has(chain[0]) &&
  !hasLocalBinding(context.scope, chain[0]) &&
  !context.module.bindings.has(chain[0]);

/**
 * Hook calls are recognised the way React Compiler does (by name) and,
 * for compiled output such as `(0, _react.useState)(…)`, by resolving to
 * React's API. Built-ins are modelled; project hooks are evaluated.
 */
const evaluateHookCall = (
  interpreter: Interpreter,
  call: CallExpression,
  callee: StaticValue,
  displayName: string,
  callArguments: StaticValue[],
  context: EvaluationContext,
): StaticValue => {
  const reference = isReactHook(callee) ? getReactApiReference(callee) : null;
  const isBuiltin = reference !== null && isBuiltinHookName(reference.api);
  context.hooks?.push({
    name: displayName,
    isBuiltin,
    location: interpreter.getLocation(context.module, call),
  });
  if (reference) {
    return modelBuiltinHook(reference.api, callArguments, createInvoker(interpreter, context), (target) =>
      readContext(context.contexts, target),
    );
  }
  if (callee.kind === "function") return interpreter.callFunction(callee, callArguments, context);
  return unknown(`${displayName}()`);
};

const invokeValue = (
  interpreter: Interpreter,
  callee: StaticValue,
  callArguments: StaticValue[],
  call: CallExpression,
  description: string,
  context: EvaluationContext,
): StaticValue => {
  switch (callee.kind) {
    case "function":
      return interpreter.callFunction(callee, callArguments, context);
    case "external": {
      const modelled = evaluateReactCall(
        interpreter,
        callee,
        callArguments,
        createInvoker(interpreter, context),
        call,
        context,
      );
      return modelled ?? unknown(`${callee.name ?? callee.importedName}()`);
    }
    default:
      return unknown(description);
  }
};

const evaluateMethodCall = (
  interpreter: Interpreter,
  target: StaticValue,
  method: string,
  callArguments: StaticValue[],
  description: string,
  targetDescription: string,
  context: EvaluationContext,
): StaticValue | null => {
  const invoke = createInvoker(interpreter, context);
  switch (target.kind) {
    case "array":
    case "list":
      return evaluateArrayMethod(target, method, callArguments, invoke, targetDescription, context);
    case "unknown":
      if (method === "then" || method === "catch" || method === "finally") return unknown(description);
      if (method === "toString" || method === "toLocaleString" || method === "toFixed") {
        return text(description);
      }
      return (
        evaluateArrayMethod(target, method, callArguments, invoke, targetDescription, context) ??
        evaluateStringMethod(text(targetDescription), method, callArguments, description)
      );
    case "literal":
    case "text":
      return evaluateStringMethod(target, method, callArguments, description);
    case "object": {
      const member = target.properties.get(method);
      if (member?.kind === "function") {
        return interpreter.callFunction(
          { ...member, thisValue: member.thisValue ?? target },
          callArguments,
          context,
        );
      }
      return member ? null : unknown(description);
    }
    case "namespace":
      if (method === "then") return callArguments[0] ? invoke(callArguments[0], [target]) : target;
      return null;
    case "function":
      switch (method) {
        case "bind":
          return callArguments[0] ? { ...target, thisValue: callArguments[0] } : target;
        case "call":
          return interpreter.callFunction(
            { ...target, thisValue: callArguments[0] ?? target.thisValue },
            callArguments.slice(1),
            context,
          );
        case "apply": {
          const applied = callArguments[1];
          return interpreter.callFunction(
            { ...target, thisValue: callArguments[0] ?? target.thisValue },
            applied?.kind === "array" ? applied.items : [],
            context,
          );
        }
        default:
          return unknown(description);
      }
    default:
      return null;
  }
};

const describeCallee = (interpreter: Interpreter, callee: Expression, context: EvaluationContext): string =>
  getMemberChain(callee)?.join(".") ?? interpreter.getSource(context.module, callee);

export const evaluateCall = (
  interpreter: Interpreter,
  call: CallExpression,
  context: EvaluationContext,
): StaticValue => {
  const callee = unwrapExpression(call.callee);
  const calleeDisplay = describeCallee(interpreter, callee, context);
  const description = `${calleeDisplay}()`;
  const callArguments = evaluateArguments(interpreter, call.arguments, context);

  if (callee.type === "Identifier" && callee.name === "require") {
    const [specifier] = call.arguments;
    if (specifier && isStringLiteral(specifier)) {
      const module = interpreter.linker.resolveImportedModule(context.module, specifier.value);
      if (module) return { kind: "namespace", module };
    }
    return unknown(description);
  }

  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
    const method = callee.property.name;
    const chain = getMemberChain(callee);
    if (chain && isGlobalChain(chain, context)) {
      const modelled = evaluateGlobalCall(chain, callArguments, createInvoker(interpreter, context), description);
      if (modelled) return modelled;
    }
    const target = interpreter.evaluateExpression(callee.object, context);
    const member = getProperty(interpreter, target, method);
    if (isHookCallee(callee) || isReactHook(member)) {
      return evaluateHookCall(interpreter, call, member, calleeDisplay, callArguments, context);
    }
    const targetDescription = interpreter.getSource(context.module, callee.object);
    const modelled = evaluateMethodCall(
      interpreter,
      target,
      method,
      callArguments,
      description,
      targetDescription,
      context,
    );
    if (modelled) return modelled;
    return invokeValue(interpreter, member, callArguments, call, description, context);
  }

  if (callee.type === "Identifier" && isGlobalChain([callee.name], context)) {
    const modelled = evaluateGlobalCall([callee.name], callArguments, createInvoker(interpreter, context), description);
    if (modelled) return modelled;
  }

  const calleeValue = interpreter.evaluateExpression(callee, context);
  if (isHookCallee(callee) || isReactHook(calleeValue)) {
    return evaluateHookCall(interpreter, call, calleeValue, calleeDisplay, callArguments, context);
  }
  return invokeValue(interpreter, calleeValue, callArguments, call, description, context);
};

/**
 * Invokes a closure: parameters bind in a fresh scope under the closure's
 * defining scope, and `async` results are treated as already awaited since
 * React awaits server components before reconciling them.
 */
export const callFunction = (
  interpreter: Interpreter,
  fn: FunctionValue,
  callArguments: StaticValue[],
  context: EvaluationContext,
): StaticValue => {
  const displayName = fn.name ?? "anonymous function";
  if (context.callDepth >= interpreter.maxCallDepth) {
    interpreter.report("call-depth", `call depth limit reached in ${displayName}`, fn.module, fn.fn);
    return unknown(`${displayName}() beyond call depth`);
  }
  if (fn.fn.type !== "ArrowFunctionExpression" && fn.fn.generator) {
    return unknown(`generator ${displayName}()`);
  }
  const inner: EvaluationContext = {
    ...context,
    module: fn.module,
    scope: createScope(fn.scope),
    thisValue: fn.thisValue,
    callDepth: context.callDepth + 1,
  };
  bindParameters(interpreter, fn.fn.params, callArguments, inner);
  if (fn.fn.body === null) return UNDEFINED;
  if (fn.fn.body.type !== "BlockStatement") return interpreter.evaluateExpression(fn.fn.body, inner);
  return getReturnValue(interpreter.evaluateStatements(fn.fn.body.body, inner), UNDEFINED);
};
