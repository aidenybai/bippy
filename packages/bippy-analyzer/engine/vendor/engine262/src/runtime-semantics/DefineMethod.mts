import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { Evaluate_PropertyName } from './all.mts';
import {
  surroundingAgent, OrdinaryFunctionCreate, MakeMethod, sourceTextMatchedBy,
} from '#self';
import type {
  ECMAScriptFunctionObject, ObjectValue, PrivateName, PropertyKeyValue,
} from '#self';

export interface DefineMethodRecord {
  readonly Key: PropertyKeyValue | PrivateName;
  readonly Closure: ECMAScriptFunctionObject;
}
/** https://tc39.es/ecma262/#sec-runtime-semantics-definemethod */
export function* DefineMethod(MethodDefinition: ParseNode.MethodDefinition, object: ObjectValue, functionPrototype?: ObjectValue): PlainEvaluator<DefineMethodRecord> {
  const { ClassElementName, UniqueFormalParameters, FunctionBody } = MethodDefinition;
  // 1. Let propKey be the result of evaluating ClassElementName.
  const propKey = Q(yield* Evaluate_PropertyName(ClassElementName));
  // 3. Let scope be the running execution context's LexicalEnvironment.
  const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 4. Let privateScope be the running execution context's PrivateEnvironment.
  const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  let prototype;
  // 5. If functionPrototype is present as a parameter, then
  if (functionPrototype !== undefined) {
    // a. Let prototype be functionPrototype.
    prototype = functionPrototype;
  } else { // 6. Else,
    // a. Let prototype be %Function.prototype%.
    prototype = surroundingAgent.intrinsic('%Function.prototype%');
  }
  // 7. Let sourceText be the source text matched by MethodDefinition.
  const sourceText = sourceTextMatchedBy(MethodDefinition);
  // 8. Let closure be OrdinaryFunctionCreate(prototype, sourceText, UniqueFormalParameters, FunctionBody, non-lexical-this, scope, privateScope).
  const closure = OrdinaryFunctionCreate(prototype, sourceText, UniqueFormalParameters!, FunctionBody, 'non-lexical-this', scope, privateScope);
  // 9. Perform MakeMethod(closure, object).
  MakeMethod(closure, object);
  // 10. Return the Record { [[Key]]: propKey, [[Closure]]: closure }.
  return { Key: propKey, Closure: closure };
}
