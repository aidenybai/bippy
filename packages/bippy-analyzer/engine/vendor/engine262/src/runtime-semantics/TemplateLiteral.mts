import { Value } from '../value.mts';
import { Q } from '../completion.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { TV } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { GetValue, ToString } from '#self';

/** https://tc39.es/ecma262/#sec-template-literals-runtime-semantics-evaluation */
//   TemplateLiteral : NoSubstitutionTemplate
//   SubstitutionTemplate : TemplateHead Expression TemplateSpans
//   TemplateSpans : TemplateTail
//   TemplateSpans : TemplateMiddleList TemplateTail
//   TemplateMiddleList : TemplateMiddle Expression
//   TemplateMiddleList : TemplateMiddleList TemplateMiddle Expression
//
// (implicit)
//   TemplateLiteral : SubstitutionTemplate
export function* Evaluate_TemplateLiteral({ TemplateSpanList, ExpressionList }: ParseNode.TemplateLiteral): ValueEvaluator {
  let str = '';
  for (let i = 0; i < TemplateSpanList.length - 1; i += 1) {
    const Expression = ExpressionList[i];
    const head = TV(TemplateSpanList[i]);
    // 2. Let subRef be the result of evaluating Expression.
    const subRef = Q(yield* Evaluate(Expression));
    // 3. Let sub be ? GetValue(subRef).
    const sub = Q(yield* GetValue(subRef));
    // 4. Let middle be ? ToString(sub).
    const middle = Q(yield* ToString(sub));
    str += head;
    str += middle;
  }
  const tail = TV(TemplateSpanList[TemplateSpanList.length - 1]);
  return Value(str + tail);
}
