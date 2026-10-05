import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { IsInTailPosition } from '../static-semantics/all.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { EvaluateCall } from './all.mts';
import { GetValue } from '#self';

/** https://tc39.es/ecma262/#sec-tagged-templates-runtime-semantics-evaluation */
//   MemberExpression :
//     MemberExpression TemplateLiteral
export function* Evaluate_TaggedTemplateExpression(node: ParseNode.TaggedTemplateExpression): ValueEvaluator {
  const { MemberExpression, TemplateLiteral } = node;
  // 1. Let tagRef be ? Evaluation of MemberExpression.
  const tagRef = Q(yield* Evaluate(MemberExpression));
  // 1. Let tagFunc be ? GetValue(tagRef).
  const tagFunc = Q(yield* GetValue(tagRef));
  // 1. Let thisCall be this MemberExpression.
  const thisCall = node;
  // 1. Let tailCall be IsInTailPosition(thisCall).
  const tailCall = IsInTailPosition(thisCall);
  // 1. Return ? EvaluateCall(tagFunc, tagRef, TemplateLiteral, tailCall).
  return Q(yield* EvaluateCall(tagFunc, tagRef, TemplateLiteral, tailCall));
}
