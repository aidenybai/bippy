import { Q } from '../completion.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import {
  ClassDefinitionEvaluation,
  InstantiateOrdinaryFunctionExpression,
  InstantiateAsyncFunctionExpression,
  InstantiateGeneratorFunctionExpression,
  InstantiateAsyncGeneratorFunctionExpression,
  InstantiateArrowFunctionExpression,
  InstantiateAsyncArrowFunctionExpression,
  DecoratorListEvaluation,
} from './all.mts';
import type {
  FunctionDeclaration, FunctionObject, PrivateName, PropertyKeyValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-function-definitions-runtime-semantics-namedevaluation */
//   FunctionExpression :
//     `function` `(` FormalParameters `)` `{` FunctionBody `}`
function NamedEvaluation_FunctionExpression(FunctionExpression: ParseNode.FunctionExpression, name: string | PropertyKeyValue | PrivateName) {
  return InstantiateOrdinaryFunctionExpression(FunctionExpression, name);
}


/** https://tc39.es/ecma262/#sec-generator-function-definitions-runtime-semantics-namedevaluation */
//   GeneratorExpression :
//     `function` `*` `(` FormalParameters `)` `{` GeneratorBody `}`
function NamedEvaluation_GeneratorExpression(GeneratorExpression: ParseNode.GeneratorExpression, name: string | PropertyKeyValue | PrivateName) {
  return InstantiateGeneratorFunctionExpression(GeneratorExpression, name);
}

/** https://tc39.es/ecma262/#sec-async-function-definitions-runtime-semantics-namedevaluation */
//   AsyncFunctionExpression :
//     `async` `function` `(` FormalParameters `)` `{` AsyncBody `}`
function NamedEvaluation_AsyncFunctionExpression(AsyncFunctionExpression: ParseNode.AsyncFunctionExpression, name: string | PropertyKeyValue | PrivateName) {
  return InstantiateAsyncFunctionExpression(AsyncFunctionExpression, name);
}

/** https://tc39.es/ecma262/#sec-asyncgenerator-definitions-namedevaluation */
//   AsyncGeneratorExpression :
//     `async` `function` `*` `(` FormalParameters `)` `{` AsyncGeneratorBody `}`
function NamedEvaluation_AsyncGeneratorExpression(AsyncGeneratorExpression: ParseNode.AsyncGeneratorExpression, name: string | PropertyKeyValue | PrivateName) {
  return InstantiateAsyncGeneratorFunctionExpression(AsyncGeneratorExpression, name);
}

/** https://tc39.es/ecma262/#sec-arrow-function-definitions-runtime-semantics-namedevaluation */
//   ArrowFunction :
//     ArrowParameters `=>` ConciseBody
function NamedEvaluation_ArrowFunction(ArrowFunction: ParseNode.ArrowFunction, name: string | PropertyKeyValue | PrivateName) {
  return InstantiateArrowFunctionExpression(ArrowFunction, name);
}

/** https://tc39.es/ecma262/#sec-arrow-function-definitions-runtime-semantics-namedevaluation */
//   AsyncArrowFunction :
//     ArrowParameters `=>` AsyncConciseBody
function NamedEvaluation_AsyncArrowFunction(AsyncArrowFunction: ParseNode.AsyncArrowFunction, name: string | PropertyKeyValue | PrivateName) {
  return InstantiateAsyncArrowFunctionExpression(AsyncArrowFunction, name);
}

/** https://tc39.es/ecma262/#sec-class-definitions-runtime-semantics-namedevaluation */
//   ClassExpression : `class` ClassTail
function* NamedEvaluation_ClassExpression(ClassExpression: ParseNode.ClassExpression, name: string | PropertyKeyValue | PrivateName) {
  const { ClassTail, Decorators } = ClassExpression;
  const decorators = Decorators ? Q(yield* DecoratorListEvaluation(Decorators)) : [];
  const sourceText = ClassExpression.sourceText;
  // 1. Let value be the result of ClassDefinitionEvaluation of ClassTail with arguments undefined and name.
  const value = yield* ClassDefinitionEvaluation(ClassTail, undefined, name, sourceText, decorators);
  Q(value);
  // 4. Return value.
  return value;
}

export function* NamedEvaluation(F: FunctionDeclaration, name: string | PropertyKeyValue | PrivateName): ValueEvaluator<FunctionObject> {
  switch (F.type) {
    case 'FunctionExpression':
      return NamedEvaluation_FunctionExpression(F, name);
    case 'GeneratorExpression':
      return NamedEvaluation_GeneratorExpression(F, name);
    case 'AsyncFunctionExpression':
      return NamedEvaluation_AsyncFunctionExpression(F, name);
    case 'AsyncGeneratorExpression':
      return NamedEvaluation_AsyncGeneratorExpression(F, name);
    case 'ArrowFunction':
      return NamedEvaluation_ArrowFunction(F, name);
    case 'AsyncArrowFunction':
      return NamedEvaluation_AsyncArrowFunction(F, name);
    case 'ClassExpression':
      return yield* NamedEvaluation_ClassExpression(F, name);
    case 'ParenthesizedExpression':
      return yield* NamedEvaluation(F.Expression, name);
    default:
      throw OutOfRange.exhaustive(F);
  }
}
