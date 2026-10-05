import { Evaluate, type PlainEvaluator } from '../evaluator.mts';
import {
  Q, X,
} from '../completion.mts';
import { Value } from '../value.mts';
import { IsAnonymousFunctionDefinition, StringValue, type FunctionDeclaration } from '../static-semantics/all.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  AddDisposableResource,
  type DisposableResourceKind,
} from '../abstract-ops/disposable-operations.mts';
import { DeclarativeEnvironmentRecord } from '../execution-context/Environment.mts';
import { NamedEvaluation, BindingInitialization } from './all.mts';
import {
  surroundingAgent,
  Assert,
  GetValue,
  InitializeReferencedBinding,
  ResolveBinding,
  IsUnresolvableReference,
  type StatementEvaluator,
} from '#self';

/** https://tc39.es/ecma262/#sec-bindingevaluation */
function* BindingEvaluation_LexicalBinding(
  LexicalBinding: ParseNode.LexicalBinding,
  kind: 'normal' | DisposableResourceKind,
): StatementEvaluator {
  switch (true) {
    case !!LexicalBinding.BindingIdentifier: {
      // LexicalBinding : BindingIdentifier Initializer
      if (LexicalBinding.Initializer) {
        const { Initializer, BindingIdentifier } = LexicalBinding;
        const bindingId = StringValue(BindingIdentifier);
        const lhs = X(ResolveBinding(bindingId, BindingIdentifier.strict));
        let value: Value;
        if (IsAnonymousFunctionDefinition(Initializer)) {
          value = Q(yield* NamedEvaluation(Initializer as FunctionDeclaration, bindingId));
        } else {
          const rhs = Q(yield* Evaluate(Initializer));
          value = Q(yield* GetValue(rhs));
        }
        if (kind !== 'normal') {
          Assert(!IsUnresolvableReference(lhs));
          const base = lhs.Base;
          Assert(base instanceof DeclarativeEnvironmentRecord);
          Q(yield* AddDisposableResource(base.DisposableResourceStack, value, kind));
        }
        Q(yield* InitializeReferencedBinding(lhs, value));
        return undefined;
      } else {
        // LexicalBinding : BindingIdentifier
        const { BindingIdentifier } = LexicalBinding;
        Assert(kind === 'normal');
        const lhs = X(ResolveBinding(StringValue(BindingIdentifier), BindingIdentifier.strict));
        X(InitializeReferencedBinding(lhs, Value.undefined));
        return undefined;
      }
    }
    case !!LexicalBinding.BindingPattern: {
      const { Initializer, BindingPattern } = LexicalBinding;
      Assert(kind === 'normal');
      const rhs = Q(yield* Evaluate(Initializer!));
      const value = Q(yield* GetValue(rhs));
      const envRecord = surroundingAgent.runningExecutionContext.LexicalEnvironment;
      return Q(yield* BindingInitialization(BindingPattern, value, envRecord));
    }
    default:
      throw OutOfRange.nonExhaustive(LexicalBinding);
  }
}

/** https://tc39.es/ecma262/#sec-bindingevaluation */
//   BindingList : BindingList `,` LexicalBinding
//
// (implicit)
//   BindingList : LexicalBinding
export function* BindingEvaluation(
  BindingList: ParseNode.BindingList,
  kind: 'normal' | DisposableResourceKind,
) {
  // 1. Let next be the result of evaluating BindingList.
  // 3. Return the result of evaluating LexicalBinding.
  let next;
  for (const LexicalBinding of BindingList) {
    next = yield* BindingEvaluation_LexicalBinding(LexicalBinding, kind);
    Q(next);
  }
  return next;
}

/** https://tc39.es/ecma262/#sec-let-and-const-declarations-runtime-semantics-evaluation */
//   LexicalDeclaration : LetOrConst BindingList `;`
export function* Evaluate_LexicalDeclaration(
  declaration: ParseNode.LexicalDeclaration | ParseNode.UsingDeclaration | ParseNode.AwaitUsingDeclaration,
): PlainEvaluator {
  switch (declaration.type) {
    case 'LexicalDeclaration': {
      Q(yield* BindingEvaluation(declaration.BindingList, 'normal'));
      return undefined;
    }
    case 'UsingDeclaration': {
      Q(yield* BindingEvaluation(declaration.BindingList, 'sync-dispose'));
      return undefined;
    }
    case 'AwaitUsingDeclaration': {
      Q(yield* BindingEvaluation(declaration.BindingList, 'async-dispose'));
      return undefined;
    }
    default:
      throw OutOfRange.exhaustive(declaration);
  }
}
