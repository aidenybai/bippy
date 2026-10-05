import {
  NormalCompletion, Q,
} from '../completion.mts';
import { Evaluate, type PlainEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { StringValue, IsAnonymousFunctionDefinition, type FunctionDeclaration } from '../static-semantics/all.mts';
import { NamedEvaluation, BindingInitialization } from './all.mts';
import {
  GetValue,
  PutValue,
  ResolveBinding,
} from '#self';

/** https://tc39.es/ecma262/#sec-variable-statement-runtime-semantics-evaluation */
//   VariableDeclaration :
//     BindingIdentifier
//     BindingIdentifier Initializer
//     BindingPattern Initializer
function* Evaluate_VariableDeclaration({ BindingIdentifier, Initializer, BindingPattern }: ParseNode.VariableDeclaration): PlainEvaluator {
  if (BindingIdentifier) {
    if (!Initializer) {
      // 1. Return NormalCompletion(empty).
      return NormalCompletion(undefined);
    }
    // 1. Let bindingId be StringValue of BindingIdentifier.
    const bindingId = StringValue(BindingIdentifier);
    // 2. Let lhs be ? ResolveBinding(bindingId).
    const lhs = Q(yield* ResolveBinding(bindingId, BindingIdentifier.strict));
    // 3. If IsAnonymousFunctionDefinition(Initializer) is true, then
    let value;
    if (IsAnonymousFunctionDefinition(Initializer)) {
      // a. Let value be NamedEvaluation of Initializer with argument bindingId.
      value = Q(yield* NamedEvaluation(Initializer as FunctionDeclaration, bindingId));
    } else { // 4. Else,
      // a. Let rhs be the result of evaluating Initializer.
      const rhs = Q(yield* Evaluate(Initializer));
      // b. Let value be ? GetValue(rhs).
      value = Q(yield* GetValue(rhs));
    }
    // 5. Return ? PutValue(lhs, value).
    return Q(yield* PutValue(lhs, value));
  }
  // 1. Let rhs be the result of evaluating Initializer.
  const rhs = Q(yield* Evaluate(Initializer!));
  // 2. Let rval be ? GetValue(rhs).
  const rval = Q(yield* GetValue(rhs));
  // 3. Return the result of performing BindingInitialization for BindingPattern passing rval and undefined as arguments.
  return yield* BindingInitialization(BindingPattern!, rval, undefined);
}

/** https://tc39.es/ecma262/#sec-variable-statement-runtime-semantics-evaluation */
//   VariableDeclarationList : VariableDeclarationList `,` VariableDeclaration
//
// (implicit)
//   VariableDeclarationList : VariableDeclaration
export function* Evaluate_VariableDeclarationList(VariableDeclarationList: ParseNode.VariableDeclarationList) {
  let next;
  for (const VariableDeclaration of VariableDeclarationList) {
    next = yield* Evaluate_VariableDeclaration(VariableDeclaration);
    Q(next);
  }
  return next;
}

/** https://tc39.es/ecma262/#sec-variable-statement-runtime-semantics-evaluation */
//   VariableStatement : `var` VariableDeclarationList `;`
export function* Evaluate_VariableStatement({ VariableDeclarationList }: ParseNode.VariableStatement): PlainEvaluator {
  const next = yield* Evaluate_VariableDeclarationList(VariableDeclarationList);
  Q(next);
  return NormalCompletion(undefined);
}
