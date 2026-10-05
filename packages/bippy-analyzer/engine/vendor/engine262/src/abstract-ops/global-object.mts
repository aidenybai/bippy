import { ExecutionContext } from '../execution-context/ExecutionContext.mts';
import { JSStringValue, Value } from '../value.mts';
import { InstantiateFunctionObject } from '../runtime-semantics/all.mts';
import {
  IsStrict,
  VarDeclaredNames,
  VarScopedDeclarations,
  LexicallyScopedDeclarations,
  BoundNames,
  IsConstantDeclaration,
  ContainsArguments,
} from '../static-semantics/all.mts';
import {
  NormalCompletion,
  EnsureCompletion,
  Q, X,
  type ValueEvaluator,
  ThrowCompletion,
  type PlainCompletion,
} from '../completion.mts';
import { Parser, wrappedParse } from '../parse.mts';
import { Evaluate, type PlainEvaluator } from '../evaluator.mts';
import { __ts_cast__ } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { Assert } from './all.mts';
import {
  HostEnsureCanCompileStrings, surroundingAgent,
  GetThisEnvironment,
  DeclarativeEnvironmentRecord,
  EnvironmentRecord,
  FunctionEnvironmentRecord,
  GlobalEnvironmentRecord,
  ObjectEnvironmentRecord,
  PrivateEnvironmentRecord,
  Throw,
} from '#self';

// This file covers abstract operations defined in
/** https://tc39.es/ecma262/#sec-global-object */

/** https://tc39.es/ecma262/#sec-performeval */
export function* PerformEval(x: Value, strictCaller: boolean, direct: boolean): ValueEvaluator {
  // 1. Assert: If direct is false, then strictCaller is also false.
  if (direct === false) {
    Assert(strictCaller === false);
  }
  // 2. If Type(x) is not String, return x.
  if (!(x instanceof JSStringValue)) {
    return x;
  }
  // 3. Let evalRealm be the current Realm Record.
  const evalRealm = surroundingAgent.currentRealmRecord;
  // 4. Perform ? HostEnsureCanCompileStrings(evalRealm, « », x, direct).
  Q(yield* HostEnsureCanCompileStrings(evalRealm, [], x.stringValue(), direct));
  // 5. Let inFunction be false.
  let inFunction = false;
  // 6. Let inMethod be false.
  let inMethod = false;
  // 7. Let inDerivedConstructor be false.
  let inDerivedConstructor = false;
  // 8. Let inClassFieldInitializer be false.
  let inClassFieldInitializer = false;
  // 9. If direct is true, then
  if (direct === true) {
    // a. Let thisEnv be ! GetThisEnvironment().
    const thisEnv = X(GetThisEnvironment());
    // b. If thisEnv is a function Environment Record, then
    if (thisEnv instanceof FunctionEnvironmentRecord) {
      // i. Let F be thisEnv.[[FunctionObject]].
      const F = thisEnv.FunctionObject;
      // ii. Let inFunction be true.
      inFunction = true;
      // iii. Let inMethod be thisEnv.HasSuperBinding().
      inMethod = thisEnv.HasSuperBinding();
      // iv. If F.[[ConstructorKind]] is derived, set inDerivedConstructor to true.
      if (F.ConstructorKind === 'derived') {
        inDerivedConstructor = true;
      }
      // v. Let classFieldInitializerName be F.[[ClassFieldInitializerName]].
      const classFieldInitializerName = F.ClassFieldInitializerName;
      // vi. If classFieldInitializerName is not empty, set inClassFieldInitializer to true.
      if (classFieldInitializerName !== undefined) {
        inClassFieldInitializer = true;
      }
    }
  }
  // 10. Perform the following substeps in an implementation-dependent order, possibly interleaving parsing and error detection:
  //   a. Let script be ParseText(! StringToCodePoints(x), Script).
  //   b. If script is a List of errors, throw a SyntaxError exception.
  //   c. If script Contains ScriptBody is false, return undefined.
  //   d. Let body be the ScriptBody of script.
  //   e. If inFunction is false, and body Contains NewTarget, throw a SyntaxError exception.
  //   f. If inMethod is false, and body Contains SuperProperty, throw a SyntaxError exception.
  //   g. If inDerivedConstructor is false, and body Contains SuperCall, throw a SyntaxError exception.
  //   h. If inClassFieldInitializer is true, and ContainsArguments of body is true, throw a SyntaxError exception.
  const privateIdentifiers: string[] = [];
  let pointer = direct ? surroundingAgent.runningExecutionContext.PrivateEnvironment : null;
  while (pointer !== null) {
    for (const binding of pointer.Names) {
      privateIdentifiers.push(binding.Description);
    }
    pointer = pointer.OuterPrivateEnvironment;
  }
  const script = wrappedParse({ source: x.stringValue() }, (parser) => parser.scope.with({
    strict: strictCaller,
    newTarget: inFunction,
    superProperty: inMethod,
    superCall: inDerivedConstructor,
    private: privateIdentifiers.length > 0,
  }, () => {
    privateIdentifiers.forEach((name) => {
      parser.scope.privateScope!.names.set(name, new Set(['field']));
    });
    return parser.parseScript();
  }));
  const scriptId = surroundingAgent.addDynamicParsedSource(surroundingAgent.currentRealmRecord, x.stringValue(), script);
  if (Array.isArray(script)) {
    Parser.decorateSyntaxErrorWithScriptId(script[0], scriptId);
    return ThrowCompletion(script[0]);
  }
  if (!script.ScriptBody) {
    return Value.undefined;
  }
  const body = script.ScriptBody;
  if (inClassFieldInitializer && ContainsArguments(body)) {
    return Throw.SyntaxError('arguments cannot be referenced in a class field initializer');
  }
  // 11. If strictCaller is true, let strictEval be true.
  // 12. Else, let strictEval be IsStrict of script.
  let strictEval;
  if (strictCaller === true) {
    strictEval = true;
  } else {
    strictEval = IsStrict(script);
  }
  // 13. Let runningContext be the running execution context.
  const runningContext = surroundingAgent.runningExecutionContext;
  let lexEnv;
  let varEnv;
  let privateEnv: null | PrivateEnvironmentRecord;
  // 14. NOTE: If direct is true, runningContext will be the execution context that performed the direct eval.
  //     If direct is false, runningContext will be the execution context for the invocation of the eval function.
  // 15. If direct is true, then
  if (direct === true) {
    // a. Let lexEnv be NewDeclarativeEnvironment(runningContext's LexicalEnvironment).
    lexEnv = new DeclarativeEnvironmentRecord(runningContext.LexicalEnvironment);
    // b. Let varEnv be runningContext's VariableEnvironment.
    varEnv = runningContext.VariableEnvironment;
    // c. Let privateEnv be runningContext's PrivateEnvironment.
    privateEnv = runningContext.PrivateEnvironment;
  } else { // 16. Else,
    // a. Let lexEnv be NewDeclarativeEnvironment(evalRealm.[[GlobalEnv]]).
    lexEnv = new DeclarativeEnvironmentRecord(evalRealm.GlobalEnv);
    // b. Let varEnv be evalRealm.[[GlobalEnv]].
    varEnv = evalRealm.GlobalEnv;
    // c. Let privateEnv be null.
    privateEnv = null;
  }
  // 17. If strictEval is true, set varEnv to lexEnv.
  if (strictEval === true) {
    varEnv = lexEnv;
  }
  // 18. If runningContext is not already suspended, suspend runningContext.
  // 19. Let evalContext be a new ECMAScript code execution context.
  const evalContext = new ExecutionContext();
  evalContext.HostDefined ??= {};
  evalContext.HostDefined.scriptId = scriptId;
  // 20. Set evalContext's Function to null.
  evalContext.Function = Value.null;
  // 21. Set evalContext's Realm to evalRealm.
  evalContext.Realm = evalRealm;
  // 22. Set evalContext's ScriptOrModule to runningContext's ScriptOrModule.
  evalContext.ScriptOrModule = runningContext.ScriptOrModule;
  // 23. Set evalContext's VariableEnvironment to varEnv.
  evalContext.VariableEnvironment = varEnv;
  // 24. Set evalContext's LexicalEnvironment to lexEnv.
  evalContext.LexicalEnvironment = lexEnv;
  // 25. Set evalContext's PrivateEnvironment to privateEnv.
  evalContext.PrivateEnvironment = privateEnv;
  // 26. Push evalContext onto the execution context stack.
  surroundingAgent.executionContextStack.push(evalContext);
  // 27. Let result be EvalDeclarationInstantiation(body, varEnv, lexEnv, privateEnv, strictEval).
  let result: PlainCompletion<void | Value> = EnsureCompletion(yield* EvalDeclarationInstantiation(body, varEnv, lexEnv, privateEnv, strictEval));
  // 28. If result.[[Type]] is normal, then
  if (result.Type === 'normal') {
    // a. Set result to the result of evaluating body.
    result = EnsureCompletion(yield* Evaluate(body));
  }
  // 29. If result.[[Type]] is normal and result.[[Value]] is empty, then
  if (result.Type === 'normal' && result.Value === undefined) {
    // a. Set result to NormalCompletion(undefined).
    result = NormalCompletion(Value.undefined);
  }
  // 30. Suspend evalContext and remove it from the execution context stack.
  // 31. Resume the context that is now on the top of the execution context stack as the running execution context.
  surroundingAgent.executionContextStack.pop(evalContext);
  // 32. Return Completion(result).
  return Q(result)!;
}

/** https://tc39.es/ecma262/#sec-evaldeclarationinstantiation */
export function* EvalDeclarationInstantiation(body: ParseNode.ScriptBody, varEnv: EnvironmentRecord, lexEnv: DeclarativeEnvironmentRecord, privateEnv: PrivateEnvironmentRecord | null, strict: boolean): PlainEvaluator {
  // 1. Let varNames be the VarDeclaredNames of body.
  const varNames = VarDeclaredNames(body);
  // 2. Let varDeclarations be the VarScopedDeclarations of body.
  const varDeclarations = VarScopedDeclarations(body);
  // 3. If strict is false, then
  if (strict === false) {
    // a. If varEnv is a global Environment Record, then
    if (varEnv instanceof GlobalEnvironmentRecord) {
      // i. For each name in varNames, do
      for (const name of varNames) {
        // 1. If varEnv.HasLexicalDeclaration(name) is true, throw a SyntaxError exception.
        if (yield* varEnv.HasLexicalDeclaration(name)) {
          return Throw.SyntaxError('$1 is already declared', name);
        }
        // 2. NOTE: eval will not create a global var declaration that would be shadowed by a global lexical declaration.
      }
    }
    // b. Let thisLex be lexEnv.
    let thisEnv: EnvironmentRecord = lexEnv;
    // c. Assert: The following loop will terminate.
    // d. Repeat, while thisEnv is not the same as varEnv,
    while (thisEnv !== varEnv) {
      __ts_cast__<EnvironmentRecord>(thisEnv);
      // i. If thisEnv is not an object Environment Record, then
      if (!(thisEnv instanceof ObjectEnvironmentRecord)) {
        // 1. NOTE: The environment of with statements cannot contain any lexical declaration so it doesn't need to be checked for var/let hoisting conflicts.
        // 2. For each name in varNames, do
        for (const name of varNames) {
          // a. If thisEnv.HasBinding(name) is true, then
          if (yield* thisEnv.HasBinding(name)) {
            // i. Throw a SyntaxError exception.
            return Throw.SyntaxError('$1 is already declared', name);
            // ii. NOTE: Annex B.3.5 defines alternate semantics for the above step.
          }
          // b. NOTE: A direct eval will not hoist var declaration over a like-named lexical declaration
        }
      }
      // ii. Set thisEnv to thisEnv.[[OuterEnv]].
      thisEnv = thisEnv.OuterEnv as EnvironmentRecord;
    }
  }
  // 4. Let privateIdentifiers be a new empty List.
  const privateIdentifiers = [];
  // 5. Let pointer be privateEnv.
  let pointer = privateEnv;
  // 6. Repeat, while pointer is not null,
  while (pointer !== null) {
    // a. For each Private Name binding of pointer.[[Names]], do
    for (const binding of pointer.Names) {
      // i. If privateIdentifiers does not contain binding.[[Description]], append binding.[[Description]] to privateIdentifiers.
      privateIdentifiers.push(binding.Description);
    }
    // b. Set pointer to pointer.[[OuterPrivateEnvironment]].
    pointer = pointer.OuterPrivateEnvironment;
  }
  // 7. If AllPrivateIdentifiersValid of body with argument privateIdentifiers is false, throw a SyntaxError exception.
  Assert(true);
  // 8. Let functionsToInitialize be a new empty List.
  const functionsToInitialize = [];
  // 9. Let declaredFunctionNames be a new empty List.
  const declaredFunctionNames = new Set<string>();
  // 10. For each d in varDeclarations, in reverse list order, do
  for (const d of [...varDeclarations].reverse()) {
    // a. If d is neither a VariableDeclaration nor a ForBinding nor a BindingIdentifier, then
    if (d.type !== 'VariableDeclaration'
        && d.type !== 'ForBinding'
        && d.type !== 'BindingIdentifier') {
      // i. Assert: d is either a FunctionDeclaration, a GeneratorDeclaration, an AsyncFunctionDeclaration, or an AsyncGeneratorDeclaration.
      Assert(d.type === 'FunctionDeclaration'
             || d.type === 'GeneratorDeclaration'
             || d.type === 'AsyncFunctionDeclaration'
             || d.type === 'AsyncGeneratorDeclaration');
      // ii. NOTE: If there are multiple function declarations for the same name, the last declaration is used.
      // iii. Let fn be the sole element of the BoundNames of d.
      const fn = BoundNames(d)[0];
      // iv. If fn is not an element of declaredFunctionNames, then
      if (!declaredFunctionNames.has(fn)) {
        // 1. If varEnv is a global Environment Record, then
        if (varEnv instanceof GlobalEnvironmentRecord) {
          // a. Let fnDefinable be ? varEnv.CanDeclareGlobalFunction(fn).
          const fnDefinable = Q(yield* varEnv.CanDeclareGlobalFunction(fn));
          // b. Let fnDefinable be ? varEnv.CanDeclareGlobalFunction(fn).
          if (!fnDefinable) {
            return Throw.TypeError('$1 is already declared', fn);
          }
        }
        // 2. Append fn to declaredFunctionNames.
        declaredFunctionNames.add(fn);
        // 3. Insert d as the first element of functionsToInitialize.
        functionsToInitialize.unshift(d);
      }
    }
  }
  // 11. NOTE: Annex B.3.3.3 adds additional steps at this point.
  // 12. Let declaredVarNames be a new empty List.
  const declaredVarNames = new Set<string>();
  // 13. For each d in varDeclarations, do
  for (const d of varDeclarations) {
    // a. If d is a VariableDeclaration, a ForBinding, or a BindingIdentifier, then
    if (d.type === 'VariableDeclaration'
        || d.type === 'ForBinding'
        || d.type === 'BindingIdentifier') {
      // i. For each String vn in the BoundNames of d, do
      for (const vn of BoundNames(d)) {
        // 1. If vn is not an element of declaredFunctionNames, then
        if (!declaredFunctionNames.has(vn)) {
          // a. If varEnv is a global Environment Record, then
          if (varEnv instanceof GlobalEnvironmentRecord) {
            // i. Let vnDefinable be ? varEnv.CanDeclareGlobalVar(vn).
            const vnDefinable = Q(yield* varEnv.CanDeclareGlobalVar(vn));
            // ii. If vnDefinable is false, throw a TypeError exception.
            if (!vnDefinable) {
              return Throw.TypeError('$1 is already declared', vn);
            }
          }
          // b. If vn is not an element of declaredVarNames, then
          if (!declaredVarNames.has(vn)) {
            // i. Append vn to declaredVarNames.
            declaredVarNames.add(vn);
          }
        }
      }
    }
  }
  // 14. NOTE: No abnormal terminations occur after this algorithm step unless
  //     varEnv is a global Environment Record and the global object is a Proxy exotic object.
  // 15. Let lexDeclarations be the LexicallyScopedDeclarations of body.
  const lexDeclarations = LexicallyScopedDeclarations(body);
  // 16. For each element d in lexDeclarations, do
  for (const d of lexDeclarations) {
    // a. NOTE: Lexically declared names are only instantiated here but not initialized.
    // b. For each element dn of the BoundNames of d, do
    for (const dn of BoundNames(d)) {
      // i. If IsConstantDeclaration of d is true, then
      if (IsConstantDeclaration(d)) {
        // 1. Perform ? lexEnv.CreateImmutableBinding(dn, true).
        Q(lexEnv.CreateImmutableBinding(dn, true));
      } else { // ii. Else,
        // 1. Perform ? lexEnv.CreateMutableBinding(dn, false).
        Q(yield* lexEnv.CreateMutableBinding(dn, false));
      }
    }
  }
  // 17. For each Parse Node f in functionsToInitialize, do
  for (const f of functionsToInitialize) {
    // a. Let fn be the sole element of the BoundNames of f.
    const fn = BoundNames(f)[0];
    // b. Let fn be the sole element of the BoundNames of f.
    const fo = InstantiateFunctionObject(f, lexEnv, privateEnv);
    // c. If varEnv is a global Environment Record, then
    if (varEnv instanceof GlobalEnvironmentRecord) {
      // i. Perform ? varEnv.CreateGlobalFunctionBinding(fn, fo, true).
      Q(yield* varEnv.CreateGlobalFunctionBinding(fn, fo, true));
    } else { // d. Else,
      // i. Let bindingExists be varEnv.HasBinding(fn).
      const bindingExists = yield* varEnv.HasBinding(fn);
      // ii. If bindingExists is false, then
      if (!bindingExists) {
        // 1. Let status be ! varEnv.CreateMutableBinding(fn, true).
        // 2. Assert: status is not an abrupt completion because of validation preceding step 12.
        X(varEnv.CreateMutableBinding(fn, true));
        // 3. Perform ! varEnv.InitializeBinding(fn, fo).
        X(varEnv.InitializeBinding(fn, fo));
      } else { // iii. Else,
        // 1. Perform ! varEnv.SetMutableBinding(fn, fo, false).
        X(varEnv.SetMutableBinding(fn, fo, false));
      }
    }
  }
  // 18. For each String vn in declaredVarNames, in list order, do
  for (const vn of declaredVarNames) {
    // a. If varEnv is a global Environment Record, then
    if (varEnv instanceof GlobalEnvironmentRecord) {
      // i. Perform ? varEnv.CreateGlobalVarBinding(vn, true).
      Q(yield* varEnv.CreateGlobalVarBinding(vn, true));
    } else { // b. Else,
      // i. Let bindingExists be varEnv.HasBinding(vn).
      const bindingExists = yield* varEnv.HasBinding(vn);
      // ii. If bindingExists is false, then
      if (!bindingExists) {
        // 1. Let status be ! varEnv.CreateMutableBinding(vn, true).
        // 2. Assert: status is not an abrupt completion because of validation preceding step 12.
        X(varEnv.CreateMutableBinding(vn, true));
        // 3. Perform ! varEnv.InitializeBinding(vn, undefined).
        X(varEnv.InitializeBinding(vn, Value.undefined));
      }
    }
  }
  // 19. Return NormalCompletion(empty).
  return NormalCompletion(undefined);
}
