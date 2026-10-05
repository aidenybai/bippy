import { Q } from '../completion.mts';
import { StringValue } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { ClassDefinitionEvaluation, DecoratorListEvaluation } from './all.mts';

/** https://tc39.es/ecma262/#sec-class-definitions-runtime-semantics-evaluation */
// ClassExpression :
//   `class` ClassTail
//   `class` BindingIdentifier ClassTail
export function* Evaluate_ClassExpression(ClassExpression: ParseNode.ClassExpression): ValueEvaluator {
  const { BindingIdentifier, ClassTail, Decorators } = ClassExpression;
  const sourceText = ClassExpression.sourceText;
  const decorators = Decorators ? Q(yield* DecoratorListEvaluation(Decorators)) : [];
  if (!BindingIdentifier) {
    // 1. Let value be ? ClassDefinitionEvaluation of ClassTail with arguments undefined and ''
    return Q(yield* ClassDefinitionEvaluation(ClassTail, undefined, '', sourceText, decorators));
  }
  // 1. Let className be StringValue of BindingIdentifier.
  const className = StringValue(BindingIdentifier);
  // 2. Let value be ? ClassDefinitionEvaluation of ClassTail with arguments className and className.
  return Q(yield* ClassDefinitionEvaluation(ClassTail, className, className, sourceText, decorators));
}
