import type { Argument, CallExpression, Expression } from "@oxc-project/types";
import { getReactApiReference } from "../link/react-api.js";
import {
  collectAssignedNames,
  getMemberChain,
  isOptionalSpine,
  isStringLiteral,
  unwrapExpression,
} from "../module/ast.js";
import { getProperty, spreadInto } from "./access.js";
import { evaluateArrayMethod, evaluateGlobalCall } from "./builtins.js";
import { evaluateCompiledClass, getCompiledClass } from "./compiled-classes.js";
import { readContext } from "./contexts.js";
import { getPrototypeMethod, isGlobalChain } from "./globals.js";
import { isBuiltinHookName, modelBuiltinHook } from "./hooks.js";
import { type EvaluationContext, getReturnValue, type Interpreter } from "./interpreter.js";
import { isHookCallee, isHookName } from "./naming.js";
import { bindParameters } from "./patterns.js";
import { type CallbackInvoker, evaluateReactCall } from "./react-calls.js";
import {
  assignVariable,
  createScope,
  declareVariable,
  isEnclosingScope,
  lookupVariable,
} from "./scope.js";
import { evaluateRegExpMethod, evaluateStringMethod } from "./strings.js";
import {
  array,
  conditional,
  type ExternalValue,
  FALSE,
  type FunctionValue,
  isFullyKnown,
  isNullishValue,
  mapConditional,
  readItem,
  type StaticValue,
  text,
  TRUE,
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
      const spread: StaticValue[] = [];
      spreadInto(spread, interpreter.evaluateExpression(argument.argument, context));
      values.push(...spread.map(readItem));
    } else values.push(interpreter.evaluateExpression(argument, context));
  }
  return values;
};

const createInvoker = (interpreter: Interpreter, context: EvaluationContext): CallbackInvoker => {
  const invoke: CallbackInvoker = (callback, callArguments) => {
    switch (callback.kind) {
      case "function":
        return interpreter.callFunction(callback, callArguments, context);
      case "global": {
        const description = `${callback.chain.join(".")}()`;
        return (
          evaluateGlobalCall(callback.chain, callArguments, invoke, description) ??
          unknown(description)
        );
      }
      default:
        return unknown(`call of ${callback.kind}`);
    }
  };
  return invoke;
};

const isReactHook = (callee: StaticValue): callee is ExternalValue => {
  if (callee.kind !== "external") return false;
  const reference = getReactApiReference(callee);
  if (reference === null || reference.source !== "react") return false;
  return isBuiltinHookName(reference.api) || isHookName(reference.api);
};

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
    return modelBuiltinHook(
      reference.api,
      callArguments,
      createInvoker(interpreter, context),
      (target) => readContext(context.contexts, target),
    );
  }
  if (callee.kind === "function") return interpreter.callFunction(callee, callArguments, context);
  return unknown(`${displayName}()`);
};

/**
 * A callee that cannot be followed may run the closures it is given before
 * returning (`reaction.track(() => { result = render(); })`), so whatever
 * they assign in the scopes enclosing the call is no longer known.
 */
const releaseCallbackWrites = (
  callArguments: StaticValue[],
  description: string,
  context: EvaluationContext,
): void => {
  for (const argument of callArguments) {
    if (argument.kind !== "function" || !isEnclosingScope(argument.scope, context.scope)) continue;
    for (const name of collectAssignedNames(argument.fn)) {
      if (lookupVariable(argument.scope, name) === undefined) continue;
      assignVariable(context.scope, name, unknown(`${name} after ${description}`));
    }
  }
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
    case "global": {
      const invoke = createInvoker(interpreter, context);
      const modelled = evaluateGlobalCall(callee.chain, callArguments, invoke, description);
      if (modelled) return modelled;
      releaseCallbackWrites(callArguments, description, context);
      return unknown(description);
    }
    case "external": {
      const modelled = evaluateReactCall(
        interpreter,
        callee,
        callArguments,
        createInvoker(interpreter, context),
        call,
        context,
      );
      if (modelled) return modelled;
      releaseCallbackWrites(callArguments, description, context);
      return unknown(`${callee.name ?? callee.importedName}()`);
    }
    default:
      releaseCallbackWrites(callArguments, description, context);
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
      if (method === "then" || method === "catch" || method === "finally")
        return unknown(description);
      if (method === "toString" || method === "toLocaleString" || method === "toFixed") {
        return text(description);
      }
      return (
        evaluateArrayMethod(target, method, callArguments, invoke, targetDescription, context) ??
        evaluateStringMethod(text(targetDescription), method, callArguments, invoke, description)
      );
    case "literal":
    case "text":
      return evaluateStringMethod(target, method, callArguments, invoke, description);
    case "regexp":
      return evaluateRegExpMethod(target, method, callArguments, invoke, description);
    case "object": {
      const member = target.properties.get(method);
      if (member?.kind === "function") {
        return interpreter.callFunction(
          { ...member, thisValue: member.thisValue ?? target },
          callArguments,
          context,
        );
      }
      if (member) return null;
      if (method === "hasOwnProperty" && callArguments[0]?.kind === "literal") {
        if (target.properties.has(String(callArguments[0].value))) return TRUE;
        return target.hasUnknownSpread ? unknown(description) : FALSE;
      }
      return unknown(description);
    }
    case "namespace":
      if (method === "then") return callArguments[0] ? invoke(callArguments[0], [target]) : target;
      return null;
    case "global": {
      if (method !== "call" && method !== "apply") {
        return evaluateGlobalCall([...target.chain, method], callArguments, invoke, description);
      }
      const [receiver = UNDEFINED, applied] = callArguments;
      const passed =
        method === "call"
          ? callArguments.slice(1)
          : applied?.kind === "array"
            ? applied.items
            : null;
      if (passed === null) return unknown(description);
      const prototypeMethod = getPrototypeMethod(target);
      if (prototypeMethod === null) {
        return evaluateGlobalCall(target.chain, passed, invoke, description);
      }
      /** `Array.prototype.slice.call(list)` is `list.slice()`. */
      return mapConditional(
        receiver,
        (arm) =>
          evaluateMethodCall(
            interpreter,
            arm,
            prototypeMethod,
            passed,
            description,
            description,
            context,
          ) ?? unknown(description),
      );
    }
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

const describeCallee = (
  interpreter: Interpreter,
  callee: Expression,
  context: EvaluationContext,
): string => getMemberChain(callee)?.join(".") ?? interpreter.getSource(context.module, callee);

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

  if (callee.type === "FunctionExpression") {
    const compiled = getCompiledClass(call);
    if (compiled) {
      return evaluateCompiledClass(interpreter, compiled, callArguments[0] ?? UNDEFINED, context);
    }
  }

  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    const method = callee.property.name;
    const chain = getMemberChain(callee);
    if (chain && isGlobalChain(chain, context)) {
      const modelled = evaluateGlobalCall(
        chain,
        callArguments,
        createInvoker(interpreter, context),
        description,
      );
      if (modelled) return modelled;
    }
    const target = interpreter.evaluateExpression(callee.object, context);
    const member = getProperty(interpreter, target, method);
    if (isHookCallee(callee) || isReactHook(member)) {
      return evaluateHookCall(interpreter, call, member, calleeDisplay, callArguments, context);
    }
    const targetDescription = interpreter.getSource(context.module, callee.object);
    const isShortCircuiting = isOptionalSpine(call);
    /** A receiver that depends on a test is called on each arm. */
    const callOn = (receiver: StaticValue): StaticValue => {
      if (receiver.kind === "conditional") {
        return conditional(receiver.test, callOn(receiver.whenTrue), callOn(receiver.whenFalse));
      }
      if (isShortCircuiting && isNullishValue(receiver)) return UNDEFINED;
      const modelled = evaluateMethodCall(
        interpreter,
        receiver,
        method,
        callArguments,
        description,
        targetDescription,
        context,
      );
      if (modelled) return modelled;
      const receiverMember =
        receiver === target ? member : getProperty(interpreter, receiver, method);
      if (isShortCircuiting && isNullishValue(receiverMember)) return UNDEFINED;
      return invokeValue(interpreter, receiverMember, callArguments, call, description, context);
    };
    return callOn(target);
  }

  if (callee.type === "Identifier" && isGlobalChain([callee.name], context)) {
    const modelled = evaluateGlobalCall(
      [callee.name],
      callArguments,
      createInvoker(interpreter, context),
      description,
    );
    if (modelled) return modelled;
  }

  const calleeValue = interpreter.evaluateExpression(callee, context);
  if (isHookCallee(callee) || isReactHook(calleeValue)) {
    return evaluateHookCall(interpreter, call, calleeValue, calleeDisplay, callArguments, context);
  }
  if (isOptionalSpine(call) && isNullishValue(calleeValue)) return UNDEFINED;
  return invokeValue(interpreter, calleeValue, callArguments, call, description, context);
};

/** Nested activations of one function before its recursion evaluates to unknown. */
export const MAX_RECURSION_DEPTH = 8;

/**
 * Whether a call to a function already on the stack is worth following.
 * Recursion reaches its base case only through fully known arguments; with
 * anything unknown in them every level would re-evaluate the same undecided
 * branches, and each branch that recurses multiplies the work.
 */
const isRecursionFollowed = (
  fn: FunctionValue,
  callArguments: StaticValue[],
  context: EvaluationContext,
): boolean => {
  const activations = context.activeCalls.get(fn.fn) ?? 0;
  if (activations === 0) return true;
  return activations < MAX_RECURSION_DEPTH && callArguments.every(isFullyKnown);
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
    interpreter.report(
      "call-depth",
      `call depth limit reached in ${displayName}`,
      fn.module,
      fn.fn,
    );
    return unknown(`${displayName}() beyond call depth`);
  }
  if (fn.fn.type !== "ArrowFunctionExpression" && fn.fn.generator) {
    return unknown(`generator ${displayName}()`);
  }
  if (!isRecursionFollowed(fn, callArguments, context)) {
    return unknown(`recursive ${displayName}()`);
  }
  const activeCalls = new Map(context.activeCalls);
  activeCalls.set(fn.fn, (activeCalls.get(fn.fn) ?? 0) + 1);
  const inner: EvaluationContext = {
    ...context,
    module: fn.module,
    scope: createScope(fn.scope),
    thisValue: fn.thisValue,
    callDepth: context.callDepth + 1,
    activeCalls,
  };
  bindParameters(interpreter, fn.fn.params, callArguments, inner);
  if (fn.fn.type !== "ArrowFunctionExpression") {
    declareVariable(inner.scope, "arguments", array(callArguments));
  }
  if (fn.fn.body === null) return UNDEFINED;
  if (fn.fn.body.type !== "BlockStatement")
    return interpreter.evaluateExpression(fn.fn.body, inner);
  return getReturnValue(interpreter.evaluateStatements(fn.fn.body.body, inner), UNDEFINED);
};
