import { Value, type Arguments } from '../value.mts';
import {
  Completion,
  AbruptCompletion,
  Q, X,
  EnsureCompletion,
  ReturnCompletion,
} from '../completion.mts';
import { Evaluate, type StatementEvaluator } from '../evaluator.mts';
import { IsAnonymousFunctionDefinition, type FunctionDeclaration } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { Mutable } from '../utils/language.mts';
import {
  Evaluate_FunctionStatementList,
  FunctionDeclarationInstantiation,
  NamedEvaluation,
} from './all.mts';
import { DeclarativeEnvironmentRecord, DisposeResources, surroundingAgent } from '#self';
import {
  Assert,
  AsyncFunctionStart,
  Call,
  GeneratorStart,
  NewPromiseCapability,
  OrdinaryCreateFromConstructor,
  AsyncGeneratorStart,
  GetValue,
  type ECMAScriptFunctionObject,
  type GeneratorObject,
  type AsyncGeneratorObject,
  type Body,
} from '#self';

export function Evaluate_AnyFunctionBody({ FunctionStatementList }: ParseNode.FunctionBody | ParseNode.AsyncBody | ParseNode.GeneratorBody | ParseNode.AsyncGeneratorBody) {
  return Evaluate_FunctionStatementList(FunctionStatementList);
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-evaluatefunctionbody */
// FunctionBody : FunctionStatementList
export function* EvaluateFunctionBody({ FunctionStatementList }: ParseNode.FunctionBody, functionObject: ECMAScriptFunctionObject, argumentsList: Arguments): StatementEvaluator {
  Q(yield* FunctionDeclarationInstantiation(functionObject, argumentsList));
  // NOTE: If the previous step resulted in a normal completion, then evaluation finished by proceeding past the end of the FunctionStatementList.
  // Note: Q can propagate return completion
  Q(yield* Evaluate_FunctionStatementList(FunctionStatementList));
  return ReturnCompletion(Value.undefined);
}

/** https://tc39.es/ecma262/#sec-arrow-function-definitions-runtime-semantics-evaluation */
// ExpressionBody : AssignmentExpression
export function* Evaluate_ExpressionBody({ AssignmentExpression }: ParseNode.ExpressionBody): StatementEvaluator {
  // 1. Let exprRef be the result of evaluating AssignmentExpression.
  const exprRef = Q(yield* Evaluate(AssignmentExpression));
  // 2. Let exprValue be ? GetValue(exprRef).
  const exprValue = Q(yield* GetValue(exprRef));
  // 3. Return Completion { [[Type]]: return, [[Value]]: exprValue, [[Target]]: empty }.
  return new Completion({ Type: 'return', Value: exprValue, Target: undefined });
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-evaluateconcisebody */
// ConciseBody : ExpressionBody
export function* EvaluateConciseBody({ ExpressionBody }: ParseNode.ConciseBody, functionObject: ECMAScriptFunctionObject, argumentsList: Arguments) {
  // 1. Perform ? FunctionDeclarationInstantiation(functionObject, argumentsList).
  Q(yield* FunctionDeclarationInstantiation(functionObject, argumentsList));
  // 2. Return the result of evaluating ExpressionBody.
  return yield* Evaluate(ExpressionBody);
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-evaluateasyncconcisebody */
// AsyncConciseBody : ExpressionBody
function* EvaluateAsyncConciseBody({ ExpressionBody }: ParseNode.AsyncConciseBody, functionObject: ECMAScriptFunctionObject, argumentsList: Arguments) {
  // 1. Let promiseCapability be ! NewPromiseCapability(%Promise%).
  const promiseCapability = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
  // 2. Let declResult be FunctionDeclarationInstantiation(functionObject, argumentsList).
  const declResult = EnsureCompletion(yield* FunctionDeclarationInstantiation(functionObject, argumentsList));
  // 3. If declResult is not an abrupt completion, then
  if (declResult.Type === 'normal') {
    // a. Perform ! AsyncFunctionStart(promiseCapability, ExpressionBody).
    X(yield* AsyncFunctionStart(promiseCapability, ExpressionBody));
  } else { // 4. Else
    // a. Perform ! Call(promiseCapability.[[Reject]], undefined, « declResult.[[Value]] »).
    X(yield* Call(promiseCapability.Reject, Value.undefined, [declResult.Value!]));
  }
  // 5. Return Completion { [[Type]]: return, [[Value]]: promiseCapability.[[Promise]], [[Target]]: empty }.
  return new Completion({ Type: 'return', Value: promiseCapability.Promise, Target: undefined });
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-evaluategeneratorbody */
// GeneratorBody : FunctionBody
export function* EvaluateGeneratorBody(GeneratorBody: ParseNode.GeneratorBody, functionObject: ECMAScriptFunctionObject, argumentsList: Arguments): StatementEvaluator {
  // 1. Perform ? FunctionDeclarationInstantiation(functionObject, argumentsList).
  Q(yield* FunctionDeclarationInstantiation(functionObject, argumentsList));
  // 2. Let G be ? OrdinaryCreateFromConstructor(functionObject, "%GeneratorPrototype%", « [[GeneratorState]], [[GeneratorContext]], [[GeneratorBrand]] »).
  const G = Q(yield* OrdinaryCreateFromConstructor(functionObject, '%GeneratorFunction.prototype.prototype%', ['GeneratorState', 'GeneratorContext', 'GeneratorBrand'])) as Mutable<GeneratorObject>;
  // 3. Set G.[[GeneratorBrand]] to empty.
  G.GeneratorBrand = undefined;
  // 4. Set G.[[GeneratorState]] to suspended-start.
  G.GeneratorState = 'suspendedStart';
  // 5. Perform GeneratorStart(G, FunctionBody).
  GeneratorStart(G, GeneratorBody);
  // 6. Return ReturnCompletion(G).
  return ReturnCompletion(G);
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-evaluateasyncgeneratorbody */
// AsyncGeneratorBody : FunctionBody
export function* EvaluateAsyncGeneratorBody(FunctionBody: ParseNode.AsyncGeneratorBody, functionObject: ECMAScriptFunctionObject, argumentsList: Arguments): StatementEvaluator {
  // 1. Perform ? FunctionDeclarationInstantiation(functionObject, argumentsList).
  Q(yield* FunctionDeclarationInstantiation(functionObject, argumentsList));
  // 2. Let generator be ? OrdinaryCreateFromConstructor(functionObject, "%AsyncGeneratorFunction.prototype.prototype%", « [[AsyncGeneratorState]], [[AsyncGeneratorContext]], [[AsyncGeneratorQueue]], [[GeneratorBrand]] »).
  const generator = Q(yield* OrdinaryCreateFromConstructor(functionObject, '%AsyncGeneratorFunction.prototype.prototype%', [
    'AsyncGeneratorState',
    'AsyncGeneratorContext',
    'AsyncGeneratorQueue',
    'GeneratorBrand',
  ])) as Mutable<AsyncGeneratorObject>;
  // 3. Set generator.[[GeneratorBrand]] to empty.
  generator.GeneratorBrand = undefined;
  generator.AsyncGeneratorState = 'suspendedStart';
  // 4. Perform ! AsyncGeneratorStart(generator, FunctionBody).
  X(AsyncGeneratorStart(generator, FunctionBody));
  // 5. Return Completion { [[Type]]: return, [[Value]]: generator, [[Target]]: empty }.
  return new Completion({ Type: 'return', Value: generator, Target: undefined });
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-evaluateasyncfunctionbody */
// AsyncBody : FunctionBody
export function* EvaluateAsyncFunctionBody(FunctionBody: ParseNode.AsyncBody, functionObject: ECMAScriptFunctionObject, argumentsList: Arguments) {
  // 1. Let promiseCapability be ! NewPromiseCapability(%Promise%).
  const promiseCapability = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
  // 2. Let declResult be FunctionDeclarationInstantiation(functionObject, argumentsList).
  const declResult = yield* FunctionDeclarationInstantiation(functionObject, argumentsList);
  // 3. If declResult is not an abrupt completion, then
  if (!(declResult instanceof AbruptCompletion)) {
    // a. Perform ! AsyncFunctionStart(promiseCapability, FunctionBody).
    X(yield* AsyncFunctionStart(promiseCapability, FunctionBody));
  } else { // 4. Else,
    // a. Perform ! Call(promiseCapability.[[Reject]], undefined, « declResult.[[Value]] »).
    X(yield* Call(promiseCapability.Reject, Value.undefined, [declResult.Value!]));
  }
  // 5. Return Completion { [[Type]]: return, [[Value]]: promiseCapability.[[Promise]], [[Target]]: empty }.
  return new Completion({ Type: 'return', Value: promiseCapability.Promise, Target: undefined });
}

// Initializer :
//   `=` AssignmentExpression
export function* EvaluateBody_AssignmentExpression(AssignmentExpression: ParseNode.Initializer, functionObject: ECMAScriptFunctionObject, argumentsList: Arguments): StatementEvaluator {
  // 1. Assert: argumentsList is empty.
  if (surroundingAgent.feature('decorators') && surroundingAgent.feature('decorators.no-bugfix.1')) {
    // TODO(decorator): spec bug
    // eslint-disable-next-line no-console
    console.assert(argumentsList.length === 0, 'Assert: argumentsList is empty.');
  } else {
    Assert(argumentsList.length === 0);
  }
  // 2. Assert: functionObject.[[ClassFieldInitializerName]] is not empty.
  Assert(functionObject.ClassFieldInitializerName !== undefined);
  let value;
  // 3. If IsAnonymousFunctionDefinition(AssignmentExpression) is true, then
  if (IsAnonymousFunctionDefinition(AssignmentExpression)) {
    // a. Let value be NamedEvaluation of Initializer with argument functionObject.[[ClassFieldInitializerName]].
    value = yield* NamedEvaluation(AssignmentExpression as FunctionDeclaration, functionObject.ClassFieldInitializerName);
  } else { // 4. Else,
    // a. Let rhs be the result of evaluating AssignmentExpression.
    const rhs = Q(yield* Evaluate(AssignmentExpression));
    // b. Let value be ? GetValue(rhs).
    value = Q(yield* GetValue(rhs));
  }
  // 5. Return Completion { [[Type]]: return, [[Value]]: value, [[Target]]: empty }.
  return new Completion({ Type: 'return', Value: X(value), Target: undefined });
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-evaluateclassstaticblockbody */
//    ClassStaticBlockBody : ClassStaticBlockStatementList
export function* EvaluateClassStaticBlockBody({ ClassStaticBlockStatementList }: ParseNode.ClassStaticBlockBody, funcObject: ECMAScriptFunctionObject): StatementEvaluator {
  X(FunctionDeclarationInstantiation(funcObject, []));
  const result = EnsureCompletion(yield* Evaluate_FunctionStatementList(ClassStaticBlockStatementList));
  const envRecord = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  Assert(envRecord instanceof DeclarativeEnvironmentRecord);
  Q(yield* DisposeResources(envRecord.DisposableResourceStack, result));
  return ReturnCompletion(Value.undefined);
}

// FunctionBody : FunctionStatementList
// ConciseBody : ExpressionBody
// GeneratorBody : FunctionBody
// AsyncGeneratorBody : FunctionBody
// AsyncBody : FunctionBody
// AsyncConciseBody : ExpressionBody
// ClassStaticBlockBody : ClassStaticBlockStatementList
export function EvaluateBody(Body: Body, functionObject: ECMAScriptFunctionObject, argumentsList: Arguments) {
  switch (Body.type) {
    case 'FunctionBody':
      return EvaluateFunctionBody(Body, functionObject, argumentsList);
    case 'ConciseBody':
      return EvaluateConciseBody(Body, functionObject, argumentsList);
    case 'GeneratorBody':
      return EvaluateGeneratorBody(Body, functionObject, argumentsList);
    case 'AsyncGeneratorBody':
      return EvaluateAsyncGeneratorBody(Body, functionObject, argumentsList);
    case 'AsyncBody':
      return EvaluateAsyncFunctionBody(Body, functionObject, argumentsList);
    case 'AsyncConciseBody':
      return EvaluateAsyncConciseBody(Body, functionObject, argumentsList);
    case 'ClassStaticBlockBody':
      Assert(argumentsList.length === 0);
      return EvaluateClassStaticBlockBody(Body, functionObject);
    default:
      return EvaluateBody_AssignmentExpression(Body, functionObject, argumentsList);
  }
}
