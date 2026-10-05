import type { ExecutionContextHostDefined, GCMarker } from '../host-defined/engine.mts';
import { __ts_cast__ } from '../utils/language.mts';
import {
  NullValue, type FunctionObject, Value, type GeneratorObject, type AsyncGeneratorObject, AbstractModuleRecord, type ScriptRecord, EnvironmentRecord, PrivateEnvironmentRecord, CallSite, PromiseCapabilityRecord, Realm,
  surroundingAgent,
  Assert,
  GetIdentifierReference,
  UndefinedValue,
  type EnvironmentRecordWithThisBinding,
  ObjectValue,
  type YieldOrAwaitEvaluator,
  type EvaluatorNextType_Await,
  type EvaluatorNextType_Yield,
  type EvaluatorYieldType_Await,
  type EvaluatorYieldType_Yield,
  type EvaluatorYieldType_AsyncYield,
  type EvaluatorNextType_AsyncYield,
  type Evaluator,
  OutOfRange,
  type EvaluatorNextType,
  type YieldCompletion,
  type EvaluatorYieldType,
  type YieldEvaluator,
  type ValueEvaluator,
  type AwaitEvaluator,
} from '#self';

/** https://tc39.es/ecma262/#running-execution-context */
export function runningExecutionContext() {
  return surroundingAgent.executionContextStack.at(-1)!;
}

/** https://tc39.es/ecma262/#current-realm */
export function currentRealmRecord() {
  return surroundingAgent.executionContextStack.at(-1)!.Realm;
}

/** https://tc39.es/ecma262/#active-function-object */
export function activeFunctionObject() {
  return surroundingAgent.executionContextStack.at(-1)!.Function;
}

/** https://tc39.es/ecma262/#sec-execution-contexts */
export class ExecutionContext {
  // Table 20: State Components for All Execution Contexts
  // https://tc39.es/ecma262/#table-state-components-for-all-execution-contexts
  CodeEvaluationState?: YieldOrAwaitEvaluator;

  Function: NullValue | FunctionObject = Value.null;

  ScriptOrModule: AbstractModuleRecord | ScriptRecord | null = null;

  Realm!: Realm;

  // Table 21: Additional State Components for ECMAScript Code Execution Contexts
  // https://tc39.es/ecma262/#table-additional-state-components-for-ecmascript-code-execution-contexts
  LexicalEnvironment!: EnvironmentRecord;

  VariableEnvironment!: EnvironmentRecord;

  PrivateEnvironment: PrivateEnvironmentRecord | null = null;

  // Table 22: Additional State Components for Generator Execution Contexts
  // https://tc39.es/ecma262/#table-additional-state-components-for-generator-execution-contexts
  Generator?: GeneratorObject | AsyncGeneratorObject;

  // NON-SPEC
  HostDefined?: ExecutionContextHostDefined;

  callSite = new CallSite(this);

  promiseCapability?: PromiseCapabilityRecord;

  poppedForTailCall = false;


  copy() {
    const e = new ExecutionContext();
    e.CodeEvaluationState = this.CodeEvaluationState;
    e.Function = this.Function;
    e.Realm = this.Realm;
    e.ScriptOrModule = this.ScriptOrModule;
    e.VariableEnvironment = this.VariableEnvironment;
    e.LexicalEnvironment = this.LexicalEnvironment;
    e.PrivateEnvironment = this.PrivateEnvironment;
    e.HostDefined = this.HostDefined;

    e.callSite = this.callSite.clone(e);
    e.promiseCapability = this.promiseCapability;
    return e;
  }

  // NON-SPEC
  mark(m: GCMarker) {
    m(this.Function);
    m(this.Realm);
    m(this.ScriptOrModule);
    m(this.VariableEnvironment);
    m(this.LexicalEnvironment);
    m(this.PrivateEnvironment);
    m(this.promiseCapability);
  }
}

export class ExecutionContextStack extends Array<ExecutionContext> {
  // This ensures that only the length taking overload is supported.
  // This is necessary to support `ArraySpeciesCreate`, which invokes
  // the constructor with argument `length`:
  constructor(length = 0) {
    super(+length);
  }

  override pop(ctx?: ExecutionContext): undefined {
    if (!ctx) {
      // TODO: add a eslint plugin for it.
      throw new Error("ExecutionContextStack.pop() must be called with a context for the sanity check");
    }
    if (!ctx?.poppedForTailCall) {
      const popped = super.pop();
      Assert(popped === ctx);
    }
  }
}

/** https://tc39.es/ecma262/#sec-getactivescriptormodule */
export function GetActiveScriptOrModule(): AbstractModuleRecord | ScriptRecord | null {
  for (let i = surroundingAgent.executionContextStack.length - 1; i >= 0; i -= 1) {
    const e = surroundingAgent.executionContextStack[i];
    if (e.ScriptOrModule !== null) {
      return e.ScriptOrModule;
    }
  }
  return null;
}

/** https://tc39.es/ecma262/#sec-resolvebinding */
export function ResolveBinding(name: string, strict: boolean, env?: EnvironmentRecord | undefined | null) {
  // 1. If env is not present or if env is undefined, then
  if (!env) {
    env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  }
  Assert(env instanceof EnvironmentRecord);

  // 3. If the code matching the syntactic production that is being evaluated is contained in strict mode code, let strict be true; else let strict be false.
  // this is handled by the caller.

  // 4. Return ? GetIdentifierReference(env, name, strict).
  return GetIdentifierReference(env, name, strict);
}

/** https://tc39.es/ecma262/#sec-getthisenvironment */
export function GetThisEnvironment(): EnvironmentRecordWithThisBinding {
  // 1. Let env be the running execution context's LexicalEnvironment.
  let env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 2. Repeat,
  while (true) {
    __ts_cast__<EnvironmentRecord>(env);
    // a. Let exists be env.HasThisBinding().
    const exists = env.HasThisBinding();
    // b. If exists is true, return envRec.
    if (exists) {
      return env as EnvironmentRecordWithThisBinding;
    }
    // c. Let outer be env.[[OuterEnv]].
    const outer = env.OuterEnv;
    // d. Assert: outer is not null.
    Assert(outer !== null);
    // e. Set env to outer.
    env = outer;
  }
}

/** https://tc39.es/ecma262/#sec-resolvethisbinding */
export function ResolveThisBinding() {
  const envRec = GetThisEnvironment();
  return envRec.GetThisBinding();
}

/** https://tc39.es/ecma262/#sec-getnewtarget */
export function GetNewTarget(): ObjectValue | UndefinedValue {
  const envRec = GetThisEnvironment();
  Assert('NewTarget' in envRec);
  return envRec.NewTarget;
}

/** https://tc39.es/ecma262/#sec-getglobalobject */
export function GetGlobalObject() {
  const currentRealm = surroundingAgent.currentRealmRecord;
  return currentRealm.GlobalObject;
}

/** https://tc39.es/ecma262/#sec-runsuspendedcontext */
export function RunSuspendedContext(context: ExecutionContext, completionRecord: EvaluatorNextType_Yield): YieldEvaluator
export function RunSuspendedContext(context: ExecutionContext, completionRecord: EvaluatorNextType_Await | EvaluatorNextType_AsyncYield): AwaitEvaluator
export function* RunSuspendedContext(context: ExecutionContext, completionRecord: EvaluatorNextType): YieldOrAwaitEvaluator {
  const callerContext = surroundingAgent.runningExecutionContext;

  // Suspend callerContext.
  // Push context onto the execution context stack; context is now the running execution context.
  surroundingAgent.executionContextStack.push(context);

  // Resume the suspended evaluation of context using completionRecord as the result of the operation that suspended it.
  // Let result be the Completion Record returned by the resumed computation.
  let iter_result: IteratorResult<EvaluatorYieldType, YieldCompletion | void>;
  let result: YieldCompletion | void;
  let completion: EvaluatorNextType = completionRecord;
  while (true) {
    // run the evaluator
    iter_result = context.CodeEvaluationState!.next(completion);
    if (iter_result.done) {
      result = iter_result.value;
      break;
    }
    const { value } = iter_result;
    // if it is a debugger break, pop it to the evaluator runner
    if (value.suspend === 'debugger' || value.suspend === 'potential-debugger') {
      completion = yield value;
    } else if (value.suspend === 'await' || value.suspend === 'async-yield') {
      return undefined;
    } else if (value.suspend === 'yield') {
      return value.value;
    } else {
      throw OutOfRange.exhaustive(value);
    }
  }

  // Assert: When we reach this step, context has already been removed from the execution context stack and callerContext is the running execution context again.
  Assert(runningExecutionContext() === callerContext);
  return result;
}

/** https://tc39.es/ecma262/#sec-runcallercontext */
export function RunCallerContext(passingValue: EvaluatorYieldType_Await): ValueEvaluator
export function RunCallerContext(passingValue: EvaluatorYieldType_Yield | EvaluatorYieldType_AsyncYield): Evaluator<YieldCompletion>
export function* RunCallerContext(passingValue: EvaluatorYieldType_Await | EvaluatorYieldType_Yield | EvaluatorYieldType_AsyncYield): Evaluator<YieldCompletion> {
  const genContext = runningExecutionContext();

  // Remove genContext from the execution context stack and restore the execution context that is at the top of the execution context stack as the running execution context.
  surroundingAgent.executionContextStack.pop(genContext);

  // Let callerContext be the running execution context.
  // Resume callerContext, passing NormalCompletion(value).
  const result: EvaluatorNextType = yield passingValue;
  Assert(result.resume === passingValue.suspend);
  // NOTE: The above step transfers control to callerContext and pauses. The only way for it to un-pause and have control proceed to the subsequent steps in this algorithm is for genContext to be resumed again, which might never happen.

  Assert(genContext === runningExecutionContext());

  // Let result be the Completion Record with which genContext was just resumed.
  return result.value!;
}
