import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import {
  PropertyDefinitionEvaluation_PropertyDefinitionList,
} from './all.mts';
import { surroundingAgent, OrdinaryObjectCreate } from '#self';

/** https://tc39.es/ecma262/#sec-object-initializer-runtime-semantics-evaluation */
//   ObjectLiteral :
//     `{` `}`
//     `{` PropertyDefinitionList `}`
//     `{` PropertyDefinitionList `,` `}`
export function* Evaluate_ObjectLiteral({ PropertyDefinitionList }: ParseNode.ObjectLiteral): ValueEvaluator {
  // 1. Let obj be OrdinaryObjectCreate(%Object.prototype%).
  const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  if (PropertyDefinitionList.length === 0) {
    return obj;
  }
  // 2. Perform ? PropertyDefinitionEvaluation of PropertyDefinitionList with arguments obj and true.
  Q(yield* PropertyDefinitionEvaluation_PropertyDefinitionList(PropertyDefinitionList, obj, true));
  // 3. Return obj.
  return obj;
}
