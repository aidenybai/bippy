import {
  Value, NullValue, ObjectValue, type PropertyKeyValue, JSStringValue,
} from '../value.mts';
import {
  StringValue,
  IsAnonymousFunctionDefinition,
  IsComputedPropertyKey,
  type FunctionDeclaration,
} from '../static-semantics/all.mts';
import { Evaluate, type PlainEvaluator, type ValueEvaluator } from '../evaluator.mts';
import {
  Q, X,
  NormalCompletion,
} from '../completion.mts';
import { kInternal } from '../utils/internal.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { NamedEvaluation, MethodDefinitionEvaluation, Evaluate_PropertyName } from './all.mts';
import {
  surroundingAgent,
  Assert,
  GetValue,
  CreateDataPropertyOrThrow,
  CopyDataProperties,
  DefineMethodProperty,
} from '#self';

/** https://tc39.es/ecma262/#sec-object-initializer-runtime-semantics-propertydefinitionevaluation */
//   PropertyDefinitionList :
//     PropertyDefinitionList `,` PropertyDefinition
export function* PropertyDefinitionEvaluation_PropertyDefinitionList(PropertyDefinitionList: ParseNode.PropertyDefinitionList, object: ObjectValue, enumerable: boolean): PlainEvaluator {
  for (const PropertyDefinition of PropertyDefinitionList) {
    Q(yield* PropertyDefinitionEvaluation_PropertyDefinition(PropertyDefinition, object, enumerable));
  }
}

// PropertyDefinition :
//   `...` AssignmentExpression
//   IdentifierReference
//   PropertyName `:` AssignmentExpression
function* PropertyDefinitionEvaluation_PropertyDefinition(PropertyDefinition: ParseNode.PropertyDefinitionLike, object: ObjectValue, enumerable: boolean) {
  switch (PropertyDefinition.type) {
    case 'IdentifierReference':
      return yield* PropertyDefinitionEvaluation_PropertyDefinition_IdentifierReference(PropertyDefinition, object, enumerable);
    case 'PropertyDefinition':
      break;
    case 'MethodDefinition':
    case 'GeneratorMethod':
    case 'AsyncMethod':
    case 'AsyncGeneratorMethod': {
      if (surroundingAgent.feature('decorators')) {
        const methodDefinition = Q(yield* MethodDefinitionEvaluation(PropertyDefinition, object));
        Q(yield* DefineMethodProperty(object, methodDefinition, true));
        return undefined;
      } else {
        const result = Q(yield* MethodDefinitionEvaluation(PropertyDefinition, object, enumerable));
        Assert(result === undefined);
        return undefined;
      }
    }
    default:
      throw OutOfRange.nonExhaustive(PropertyDefinition);
  }
  // PropertyDefinition :
  //   PropertyName `:` AssignmentExpression
  //   `...` AssignmentExpression
  const { PropertyName, AssignmentExpression } = PropertyDefinition;
  if (!PropertyName) {
    // 1. Let exprValue be the result of evaluating AssignmentExpression.
    const exprValue = Q(yield* Evaluate(AssignmentExpression));
    // 2. Let fromValue be ? GetValue(exprValue).
    const fromValue = Q(yield* GetValue(exprValue));
    // 3. Let excludedNames be a new empty List.
    const excludedNames: PropertyKeyValue[] = [];
    // 4. Return ? CopyDataProperties(object, fromValue, excludedNames).
    return Q(yield* CopyDataProperties(object, fromValue, excludedNames));
  }
  // 1. Let propKey be the result of evaluating PropertyName.
  const propKey = Q(yield* Evaluate_PropertyName(PropertyName));
  // 3. If this PropertyDefinition is contained within a Script which is being evaluated for JSON.parse, then
  let isProtoSetter;
  if (surroundingAgent.runningExecutionContext?.HostDefined?.[kInternal]?.json) {
    isProtoSetter = false;
  } else if (!IsComputedPropertyKey(PropertyName) && (propKey as JSStringValue).stringValue() === '__proto__') { // 3. Else, If _propKey_ is the String value *"__proto__"* and if IsComputedPropertyKey(|PropertyName|) is *false*,
    // a. Let isProtoSetter be true.
    isProtoSetter = true;
  } else { // 4. Else,
    // a. Let isProtoSetter be false.
    isProtoSetter = false;
  }
  let propValue;
  // 5. If IsAnonymousFunctionDefinition(AssignmentExpression) is true and isProtoSetter is false, then
  if (IsAnonymousFunctionDefinition(AssignmentExpression) && !isProtoSetter) {
    // a. Let propValue be NamedEvaluation of AssignmentExpression with argument propKey.
    propValue = yield* NamedEvaluation(AssignmentExpression as FunctionDeclaration, propKey);
  } else { // 6. Else,
    // a. Let exprValueRef be the result of evaluating AssignmentExpression.
    const exprValueRef = Q(yield* Evaluate(AssignmentExpression));
    // b. Let propValue be ? GetValue(exprValueRef).
    propValue = Q(yield* GetValue(exprValueRef));
  }
  // 7. If isProtoSetter is true, then
  if (isProtoSetter) {
    // a. If Type(propValue) is either Object or Null, then
    if (propValue instanceof ObjectValue || propValue instanceof NullValue) {
      // i. Return object.[[SetPrototypeOf]](propValue).
      return yield* object.SetPrototypeOf(propValue);
    }
    // b. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }
  // 8. Assert: enumerable is true.
  Assert(enumerable);
  // 9. Assert: object is an ordinary, extensible object with no non-configurable properties.
  // 10. Return ! CreateDataPropertyOrThrow(object, propKey, propValue).
  return X(CreateDataPropertyOrThrow(object, propKey as PropertyKeyValue, X(propValue)));
}

// PropertyDefinition : IdentifierReference
function* PropertyDefinitionEvaluation_PropertyDefinition_IdentifierReference(IdentifierReference: ParseNode.IdentifierReference, object: ObjectValue, enumerable: boolean): ValueEvaluator {
  // 1. Let propName be StringValue of IdentifierReference.
  const propName = StringValue(IdentifierReference);
  // 2. Let exprValue be the result of evaluating IdentifierReference.
  const exprValue = Q(yield* Evaluate(IdentifierReference));
  // 3. Let propValue be ? GetValue(exprValue).
  const propValue = Q(yield* GetValue(exprValue));
  // 4. Assert: enumerable is true.
  Assert(enumerable);
  // 5. Assert: object is an ordinary, extensible object with no non-configurable properties.
  // 6. Return ! CreateDataPropertyOrThrow(object, propName, propValue).
  return Value(X(CreateDataPropertyOrThrow(object, propName, propValue)));
}
