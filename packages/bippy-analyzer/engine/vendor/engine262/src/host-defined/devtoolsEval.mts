import {
  AsyncBlockStart,
  ContainsArguments,
  DeclarativeEnvironmentRecord,
  DynamicParsedCodeRecord,
  EnsureCompletion,
  EnvironmentRecord,
  EvalDeclarationInstantiation,
  Evaluate,
  ExecutionContext,
  FunctionEnvironmentRecord, GetThisEnvironment, IsStrict, ManagedRealm, NewPromiseCapability, NormalCompletion, surroundingAgent, Throw, ThrowCompletion, X, Value, wrappedParse, type PlainCompletion, type ValueCompletion, type ValueEvaluator,
} from '#self';

const cascadeStack = new WeakMap<EnvironmentRecord, EnvironmentRecord>();
// This is modified based on PerformEval, used internally for devtools console.
export function* performDevtoolsEval(source: string, evalRealm: ManagedRealm, strictCaller: boolean, doNotTrack: boolean): ValueEvaluator {
  let inFunction = false;
  let inMethod = false;
  let inDerivedConstructor = false;
  let inClassFieldInitializer = false;

  let scriptContext: ExecutionContext | undefined;
  if (!surroundingAgent.runningExecutionContext?.LexicalEnvironment) {
    // top level devtools eval
    const globalEnv = evalRealm.GlobalEnv;
    scriptContext = new ExecutionContext();
    scriptContext.Function = Value.null;
    scriptContext.Realm = evalRealm;
    scriptContext.VariableEnvironment = globalEnv;
    if (!cascadeStack.has(globalEnv)) {
      cascadeStack.set(globalEnv, new DeclarativeEnvironmentRecord(globalEnv));
    }
    scriptContext.LexicalEnvironment = cascadeStack.get(evalRealm.GlobalEnv)!;
    scriptContext.PrivateEnvironment = null;
    surroundingAgent.executionContextStack.push(scriptContext);
  }

  const thisEnv = GetThisEnvironment();
  if (thisEnv instanceof FunctionEnvironmentRecord) {
    const F = thisEnv.FunctionObject;
    inFunction = true;
    inMethod = thisEnv.HasSuperBinding();
    if (F.ConstructorKind === 'derived') {
      inDerivedConstructor = true;
    }
    const classFieldInitializerName = F.ClassFieldInitializerName;
    if (classFieldInitializerName !== undefined) {
      inClassFieldInitializer = true;
    }
  }

  let isAsync = false;
  const parseOption = { source, allowAllPrivateNames: true };
  const parseParam = {
    strict: strictCaller,
    newTarget: inFunction,
    superProperty: inMethod,
    superCall: inDerivedConstructor,
    private: true,
  };
  let script = wrappedParse(parseOption, (parser) => parser.scope.with(parseParam, () => parser.parseScript()));
  if (Array.isArray(script)) {
    isAsync = true;
    script = wrappedParse(parseOption, (parser) => parser.scope.with({ ...parseParam, await: true }, () => parser.parseScript()));
  }
  if (Array.isArray(script)) {
    if (scriptContext) {
      surroundingAgent.executionContextStack.pop(scriptContext);
    }
    return ThrowCompletion(script[0]);
  }
  if (!script.ScriptBody) {
    if (scriptContext) {
      surroundingAgent.executionContextStack.pop(scriptContext);
    }
    return Value.undefined;
  }
  const body = script.ScriptBody;
  if (inClassFieldInitializer && ContainsArguments(body)) {
    return Throw.SyntaxError('arguments cannot be referenced in a class field initializer');
  }

  const scriptId = doNotTrack ? undefined : surroundingAgent.addDynamicParsedSource(surroundingAgent.currentRealmRecord, source, script);
  if (!doNotTrack) {
    (surroundingAgent.parsedSources.get(scriptId!) as DynamicParsedCodeRecord).HostDefined.isInspectorEval = true;
    if (scriptContext) {
      scriptContext.HostDefined ??= {};
      scriptContext.HostDefined.scriptId = scriptId;
    }
  }

  let strictEval;
  if (strictCaller === true) {
    strictEval = true;
  } else if (script) {
    strictEval = IsStrict(script);
  } else {
    strictEval = true;
  }

  const runningContext = surroundingAgent.runningExecutionContext;
  let parentLexicalEnvironment;
  if (cascadeStack.has(runningContext.LexicalEnvironment)) {
    parentLexicalEnvironment = cascadeStack.get(runningContext.LexicalEnvironment)!;
  } else {
    parentLexicalEnvironment = runningContext.LexicalEnvironment;
  }
  const lexEnv = new DeclarativeEnvironmentRecord(parentLexicalEnvironment);
  cascadeStack.set(runningContext.LexicalEnvironment, lexEnv);
  let varEnv;
  const privateEnv = runningContext.PrivateEnvironment;
  varEnv = runningContext.VariableEnvironment;
  if (strictEval === true) {
    varEnv = lexEnv;
  }
  const evalContext = new ExecutionContext();
  evalContext.HostDefined ??= {};
  evalContext.HostDefined.scriptId = scriptId;
  evalContext.Function = Value.null;
  evalContext.Realm = evalRealm;
  evalContext.ScriptOrModule = runningContext.ScriptOrModule;
  evalContext.VariableEnvironment = varEnv;
  evalContext.LexicalEnvironment = lexEnv;
  evalContext.PrivateEnvironment = privateEnv;
  surroundingAgent.executionContextStack.push(evalContext);

  let result: PlainCompletion<void | Value>;
  result = EnsureCompletion(yield* EvalDeclarationInstantiation(body, varEnv, lexEnv, privateEnv, strictEval));
  if (result.Type === 'normal') {
    if (isAsync) {
      const promiseCapability = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
      X(yield* AsyncBlockStart(promiseCapability, function* evaluate(): ValueEvaluator {
        return yield* Evaluate(body);
      }, evalContext));
      result = promiseCapability.Promise;
    } else {
      result = EnsureCompletion(yield* Evaluate(body));
    }
  }

  result = EnsureCompletion(result);
  if (result.Type === 'normal' && result.Value === undefined) {
    result = NormalCompletion(Value.undefined);
  }
  surroundingAgent.executionContextStack.pop(evalContext);
  if (scriptContext) {
    surroundingAgent.executionContextStack.pop(scriptContext);
  }
  return result as ValueCompletion;
}
