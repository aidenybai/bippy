import { isArray } from '../utils/language.mts';
import { captureStack } from '../utils/stack.mts';
import { setErrorHostInternalSlot } from '../intrinsics/Error.mts';
import type { ErrorObject } from '../intrinsics/Error.mts';
import {
  Assert, Call, Construct, CopyNameAndLength, CreateBuiltinFunction, DeclarativeEnvironmentRecord, EnvironmentRecord, EvalDeclarationInstantiation, Evaluate, ExecutionContext, Get, GetFunctionRealm, HasOwnProperty, HostEnsureCanCompileStrings, HostLoadImportedModule, IsCallable, isErrorObject, isModuleNamespaceObject, JSStringValue, MakeBasicObject, NewPromiseCapability, NormalCompletion, ObjectValue, Parser, PerformPromiseThen, Q, RequireInternalSlot, surroundingAgent, Throw, ThrowCompletion, Value, wrappedParse, X, type Arguments, type BuiltinFunctionObject, type ExoticObject, type FunctionObject, type Mutable, type PlainCompletion, type Realm, type ValueEvaluator,
} from '#self';

/** https://tc39.es/proposal-shadowrealm/#table-internal-slots-of-wrapped-function-exotic-objects */
export interface WrappedFunctionExoticObject extends BuiltinFunctionObject, ExoticObject {
  readonly WrappedTargetFunction: FunctionObject;
  readonly Realm: Realm;
}

export function isWrappedFunctionExoticObject(value: Value): value is WrappedFunctionExoticObject {
  return 'WrappedTargetFunction' in value;
}

/** https://tc39.es/proposal-shadowrealm/#sec-wrapped-function-exotic-objects-call-thisargument-argumentslist */
function* WrappedFunction_Call(this: WrappedFunctionExoticObject, thisArgument: Value, argumentList: Arguments): ValueEvaluator {
  const F = this;
  const callerContext = surroundingAgent.runningExecutionContext;
  const calleeContext = PrepareForWrappedFunctionCall(F);
  Assert(surroundingAgent.runningExecutionContext === calleeContext);
  const result = yield* OrdinaryWrappedFunctionCall(F, thisArgument, argumentList);
  surroundingAgent.executionContextStack.pop(calleeContext);
  Assert(surroundingAgent.runningExecutionContext === callerContext);
  return Q(result);
}

/** https://tc39.es/proposal-shadowrealm/#sec-create-type-error-copy */
export function CreateTypeErrorCopy(realmRecord: Realm, non_spec_evalRealm: Realm, originalError: Value): ObjectValue {
  realmRecord.HostDefined.attachingInspectorReportError?.(non_spec_evalRealm, originalError);
  let message = 'An error occurred in a ShadowRealm.';
  const newError = X(Construct(realmRecord.Intrinsics['%TypeError%'], [Value(message)])) as ErrorObject;
  if (originalError instanceof ObjectValue) {
    if (isErrorObject(originalError)) {
      newError.HostDefinedFormattedStack = originalError.HostDefinedFormattedStack;
      newError.HostDefinedStack = originalError.HostDefinedStack;
      newError.HostDefinedMessage = originalError.HostDefinedMessage;
      newError.HostDefinedMessageString = originalError.HostDefinedMessageString;
    } else {
      const S = captureStack();
      if (originalError.properties.has('message')) {
        const messageProp = originalError.properties.get('message');
        if (messageProp && messageProp.Value && messageProp.Value instanceof JSStringValue) {
          message = messageProp.Value.stringValue();
        }
      }
      X(setErrorHostInternalSlot(newError, S, message));
    }
  }
  return newError;
}

/** https://tc39.es/proposal-shadowrealm/#sec-ordinary-wrapped-function-call */
export function* OrdinaryWrappedFunctionCall(F: WrappedFunctionExoticObject, thisArgument: Value, argumentList: Arguments): ValueEvaluator {
  const target = F.WrappedTargetFunction;
  Assert(IsCallable(target));
  const callerRealm = F.Realm;

  // Note: Any exception objects produced after this point are associated with callerRealm.
  const targetRealm = Q(GetFunctionRealm(target));
  const wrappedArgs: Value[] = [];
  for (const arg of argumentList.values()) {
    const wrappedValue = Q(yield* GetWrappedValue(targetRealm, arg));
    wrappedArgs.push(wrappedValue);
  }
  const wrappedThisArgument = Q(yield* GetWrappedValue(targetRealm, thisArgument));
  const result = yield* Call(target, wrappedThisArgument, wrappedArgs);
  if (result instanceof Value || result instanceof NormalCompletion) {
    return Q(yield* GetWrappedValue(callerRealm, result instanceof Value ? result : result.Value));
  } else {
    const copiedError = CreateTypeErrorCopy(callerRealm, targetRealm, result.Value);
    return ThrowCompletion(copiedError);
  }
}

/** https://tc39.es/proposal-shadowrealm/#sec-prepare-for-wrapped-function-call */
export function PrepareForWrappedFunctionCall(F: WrappedFunctionExoticObject) {
  const calleeContext = new ExecutionContext();
  calleeContext.Function = F;
  const calleeRealm = F.Realm;
  calleeContext.Realm = calleeRealm;
  calleeContext.ScriptOrModule = null;
  surroundingAgent.executionContextStack.push(calleeContext);
  // 9. NOTE: Any exception objects produced after this point are associated with calleeRealm.
  return calleeContext;
}

/** https://tc39.es/proposal-shadowrealm/#sec-wrappedfunctioncreate */
export function* WrappedFunctionCreate(callerRealm: Realm, Target: FunctionObject) {
  const internalSlotsList = ['WrappedTargetFunction', 'Call', 'Realm', 'Prototype', 'Extensible'];
  const wrapped = MakeBasicObject(internalSlotsList) as Mutable<WrappedFunctionExoticObject>;
  wrapped.Prototype = callerRealm.Intrinsics['%Function.prototype%'];
  wrapped.Call = WrappedFunction_Call;
  wrapped.WrappedTargetFunction = Target;
  wrapped.Realm = callerRealm;
  const result = yield* CopyNameAndLength(wrapped, Target);
  if (result instanceof ThrowCompletion) {
    return Throw.TypeError('Cannot create a ShadowRealm wrapped function on $1', Target);
  }
  return wrapped;
}

/** https://tc39.es/proposal-shadowrealm/#sec-performshadowrealmeval */
export function* PerformShadowRealmEval(sourceText: string, callerRealm: Realm, evalRealm: Realm): ValueEvaluator {
  Q(yield* HostEnsureCanCompileStrings(evalRealm, [], sourceText, false));
  const script = wrappedParse({ source: sourceText }, (p) => p.scope.with({
    newTarget: false,
    superProperty: false,
    superCall: false,
  }, () => p.parseScript()));
  const scriptId = surroundingAgent.addDynamicParsedSource(surroundingAgent.currentRealmRecord, sourceText, script);
  if (isArray(script)) {
    Parser.decorateSyntaxErrorWithScriptId(script[0], scriptId);
    return ThrowCompletion(script[0]);
  }
  if (!script.ScriptBody) {
    return Value.undefined;
  }

  const body = script.ScriptBody;
  const strictEval = script.strict;
  const evalContext = GetShadowRealmContext(evalRealm, strictEval);
  evalContext.HostDefined ??= {};
  evalContext.HostDefined.scriptId = scriptId;
  // TODO: spec bug? dynamic import leak
  // evalContext.ScriptOrModule = scriptRec;
  const lexEnv = evalContext.LexicalEnvironment;
  // TODO: spec bug?
  Assert(lexEnv instanceof DeclarativeEnvironmentRecord);
  const varEnv = evalContext.VariableEnvironment;
  surroundingAgent.executionContextStack.push(evalContext);
  let result: PlainCompletion<Value | void> = yield* EvalDeclarationInstantiation(body, varEnv, lexEnv, null, strictEval);
  if (result instanceof NormalCompletion) {
    result = yield* Evaluate(body);
  }
  if (result === undefined || (result instanceof NormalCompletion && result.Value === undefined)) {
    result = NormalCompletion(Value.undefined);
  }
  surroundingAgent.executionContextStack.pop(evalContext);
  if (result instanceof ThrowCompletion) {
    const copiedError = CreateTypeErrorCopy(callerRealm, evalRealm, result.Value);
    return ThrowCompletion(copiedError);
  }
  return Q(yield* GetWrappedValue(callerRealm, X(result) || Value.undefined));
}

/** https://tc39.es/proposal-shadowrealm/#sec-shadowrealmimportvalue */
export function ShadowRealmImportValue(specifierString: string, exportNameString: string, callerRealm: Realm, evalRealm: Realm): Value {
  const evalContext = GetShadowRealmContext(evalRealm, true);
  const innerCapability = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
  surroundingAgent.executionContextStack.push(evalContext);
  const referrer = evalContext.Realm;
  HostLoadImportedModule(referrer, {
    Specifier: specifierString,
    Phase: 'evaluation',
    Attributes: [],
    ImportedNames: 'all',
  }, undefined, { data: innerCapability });
  surroundingAgent.executionContextStack.pop(evalContext);
  const onFullfilled = CreateBuiltinFunction(function* onFullfilled([exports = Value.undefined]) {
    Assert(isModuleNamespaceObject(exports));
    const f = surroundingAgent.activeFunctionObject as FunctionObject;
    const string = exportNameString;
    const hasOwn = Q(yield* HasOwnProperty(exports, string));
    if (!hasOwn) {
      return Throw.TypeError('Module $1 does not have an export named $2', specifierString, string);
    }
    const value = Q(yield* Get(exports, string));
    const realm = f.Realm;
    return Q(yield* GetWrappedValue(realm, value));
  }, 1, Value(''), [], callerRealm);
  const onRejected = CreateBuiltinFunction((([error = Value.undefined]) => {
    // 1. Let realmRecord be the function's associated Realm Record.
    const realmRecord = callerRealm;
    const copiedError = CreateTypeErrorCopy(realmRecord, evalRealm, error);
    return ThrowCompletion(copiedError);
  }), 1, Value(''), [], callerRealm);
  const promiseCapability = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
  return PerformPromiseThen(innerCapability.Promise, onFullfilled, onRejected, promiseCapability);
}

/** https://tc39.es/proposal-shadowrealm/#sec-getwrappedvalue */
export function* GetWrappedValue(callerRealm: Realm, value: Value): ValueEvaluator {
  if (value instanceof ObjectValue) {
    if (!IsCallable(value)) {
      return Throw.TypeError('Only primitive values and functions can be passed across the ShadowRealm boundary, but $1 is an object', value);
    }
    return Q(yield* WrappedFunctionCreate(callerRealm, value));
  }
  return value;
}

/** https://tc39.es/proposal-shadowrealm/#sec-validateshadowrealmobject */
export function ValidateShadowRealmObject(O: Value): PlainCompletion<void> {
  Q(RequireInternalSlot(O, 'ShadowRealm'));
}

/** https://tc39.es/proposal-shadowrealm/#sec-getshadowrealmcontext */
export function GetShadowRealmContext(shadowRealmRecord: Realm, strictEval: boolean): ExecutionContext {
  const lexEnv = new DeclarativeEnvironmentRecord(shadowRealmRecord.GlobalEnv);
  let varEnv: EnvironmentRecord = shadowRealmRecord.GlobalEnv;
  if (strictEval) {
    varEnv = lexEnv;
  }
  const context = new ExecutionContext();
  context.Function = Value.null;
  context.Realm = shadowRealmRecord;
  context.ScriptOrModule = null;
  context.VariableEnvironment = varEnv;
  context.LexicalEnvironment = lexEnv;
  context.PrivateEnvironment = null;
  return context;
}
