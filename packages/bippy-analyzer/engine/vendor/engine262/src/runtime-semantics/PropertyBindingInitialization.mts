import { BoundNames } from '../static-semantics/all.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { isArray } from '../utils/language.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { Evaluate_PropertyName, KeyedBindingInitialization } from './all.mts';
import {
    Value,
  type EnvironmentRecord, type PlainCompletion, type PropertyKeyValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-destructuring-binding-patterns-runtime-semantics-propertybindinginitialization */
// BindingPropertyList : BIndingPropertyList `,` BindingProperty
// BindingProperty :
//   SingleNameBinding
//   PropertyName `:` BindingElement
export function* PropertyBindingInitialization(node: ParseNode.BindingPropertyList | ParseNode.BindingPropertyLike, value: Value, environment: EnvironmentRecord | undefined): PlainEvaluator<PropertyKeyValue[]> {
  if (isArray(node)) {
    // 1. Let boundNames be ? PropertyBindingInitialization of BindingPropertyList with arguments value and environment.
    // 2. Let nextNames be ? PropertyBindingInitialization of BindingProperty with arguments value and environment.
    // 3. Append each item in nextNames to the end of boundNames.
    // 4. Return boundNames.
    const boundNames: PlainCompletion<PropertyKeyValue[]> = [];
    for (const item of node) {
      const nextNames = Q(yield* PropertyBindingInitialization(item, value, environment));
      boundNames.push(...nextNames);
    }
    return boundNames;
  }
  if ('PropertyName' in node && node.PropertyName) {
    // 1. Let P be the result of evaluating PropertyName.
    const P = yield* Evaluate_PropertyName(node.PropertyName);
    Q(P);
    // 3. Perform ? KeyedBindingInitialization of BindingElement with value, environment, and P as the arguments.
    Q(yield* KeyedBindingInitialization(node.BindingElement, value, environment, P as PropertyKeyValue));
    // 4. Return a new List containing P.
    return [P as PropertyKeyValue];
  } else {
    // 1. Let name be the string that is the only element of BoundNames of SingleNameBinding.
    const name = BoundNames(node)[0];
    // 2. Perform ? KeyedBindingInitialization for SingleNameBinding using value, environment, and name as the arguments.
    Q(yield* KeyedBindingInitialization(node as ParseNode.SingleNameBinding, value, environment, name));
    // 3. Return a new List containing name.
    return [Value(name)];
  }
}
