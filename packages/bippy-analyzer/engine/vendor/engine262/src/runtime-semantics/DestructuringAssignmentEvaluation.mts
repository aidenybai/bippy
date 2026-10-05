import {
  JSStringValue, ReferenceRecord, Value, type PropertyKeyValue,
} from '../value.mts';
import {
  IsAnonymousFunctionDefinition,
  IsIdentifierRef,
  StringValue,
  type FunctionDeclaration,
} from '../static-semantics/all.mts';
import {
  Evaluate, type PlainEvaluator, type StatementEvaluator,
} from '../evaluator.mts';
import {
  Q, X,
  Completion,
  AbruptCompletion,
  NormalCompletion,
  EnsureCompletion,
} from '../completion.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  Evaluate_PropertyName,
  NamedEvaluation,
  refineLeftHandSideExpression,
} from './all.mts';
import { surroundingAgent } from '#self';
import {
  ArrayCreate,
  CopyDataProperties,
  CreateDataPropertyOrThrow,
  GetIterator,
  GetV,
  GetValue,
  IteratorClose,
  IteratorStep,
  OrdinaryObjectCreate,
  PutValue,
  ResolveBinding,
  RequireObjectCoercible,
  ToString,
  F,
  Assert,
  type IteratorRecord,
  IteratorStepValue,
} from '#self';

// ObjectAssignmentPattern :
//  `{` `}`
//  `{` AssignmentPropertyList `}`
//  `{` AssignmentPropertyList `,` `}`
//  `{` AssignmentPropertyList `,` AssignmentRestProperty? `}`
function* DestructuringAssignmentEvaluation_ObjectAssignmentPattern({ AssignmentPropertyList, AssignmentRestProperty }: ParseNode.ObjectAssignmentPattern, value: Value): PlainEvaluator {
  // 1. Perform ? RequireObjectCoercible(value).
  Q(RequireObjectCoercible(value));
  // 2. Perform ? PropertyDestructuringAssignmentEvaluation for AssignmentPropertyList using value as the argument.
  const excludedNames: readonly PropertyKeyValue[] = Q(yield* PropertyDestructuringAssignmentEvaluation(AssignmentPropertyList, value));
  if (AssignmentRestProperty) {
    Q(yield* RestDestructuringAssignmentEvaluation(AssignmentRestProperty, value, excludedNames));
  }
  // 3. Return NormalCompletion(empty).
  return NormalCompletion(undefined);
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-restdestructuringassignmentevaluation */
// AssignmentRestProperty : `...` DestructuringAssignmentTarget
function* RestDestructuringAssignmentEvaluation({ DestructuringAssignmentTarget }: ParseNode.AssignmentRestProperty, value: Value, excludedNames: readonly PropertyKeyValue[]): StatementEvaluator {
  // 1. Let lref be the result of evaluating DestructuringAssignmentTarget.
  const lref = Q(yield* Evaluate(DestructuringAssignmentTarget));
  Q(lref);
  // 3. Let restObj be OrdinaryObjectCreate(%Object.prototype%).
  const restObj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  // 4. Perform ? CopyDataProperties(restObj, value, excludedNames).
  Q(yield* CopyDataProperties(restObj, value, excludedNames));
  // 5. Return PutValue(lref, restObj).
  return yield* PutValue(lref, restObj);
}

function* PropertyDestructuringAssignmentEvaluation(AssignmentPropertyList: ParseNode.ObjectAssignmentPattern['AssignmentPropertyList'], value: Value): PlainEvaluator<PropertyKeyValue[]> {
  const propertyNames: PropertyKeyValue[] = [];
  for (const AssignmentProperty of AssignmentPropertyList) {
    if ('IdentifierReference' in AssignmentProperty) {
      // 1. Let P be StringValue of IdentifierReference.
      const P = StringValue(AssignmentProperty.IdentifierReference);
      // 2. Let lref be ? ResolveBinding(P).
      const lref = Q(yield* ResolveBinding(P, AssignmentProperty.IdentifierReference.strict));
      // 3. Let v be ? GetV(value, P).
      let v = Q(yield* GetV(value, P));
      // 4. If Initializer? is present and v is undefined, then
      if (AssignmentProperty.Initializer && v === Value.undefined) {
        // a. If IsAnonymousFunctionDefinition(Initializer) is true, then
        if (IsAnonymousFunctionDefinition(AssignmentProperty.Initializer)) {
          // i. Set v to the result of performing NamedEvaluation for Initializer with argument P.
          v = Q(yield* NamedEvaluation(AssignmentProperty.Initializer as FunctionDeclaration, P));
        } else { // b. Else,
          // i. Let defaultValue be the result of evaluating Initializer.
          const defaultValue = Q(yield* Evaluate(AssignmentProperty.Initializer));
          // ii. Set v to ? GetValue(defaultValue)
          v = Q(yield* GetValue(defaultValue));
        }
      }
      // 5. Perform ? PutValue(lref, v).
      Q(yield* PutValue(lref, v));
      // 6. Return a new List containing P.
      propertyNames.push(Value(P));
    } else {
      Assert('PropertyName' in AssignmentProperty);
      // 1. Let name be the result of evaluating PropertyName.
      const name = yield* Evaluate_PropertyName(AssignmentProperty.PropertyName!);
      Q(name);
      // 3. Perform ? KeyedDestructuringAssignmentEvaluation of AssignmentElement with value and name as the arguments.
      Q(yield* KeyedDestructuringAssignmentEvaluation(AssignmentProperty.AssignmentElement, value, name as PropertyKeyValue));
      // 4. Return a new List containing name.
      propertyNames.push(name as PropertyKeyValue);
    }
  }
  return propertyNames;
}

// AssignmentElement : DestructuringAssignmentTarget Initializer?
function* KeyedDestructuringAssignmentEvaluation({
  DestructuringAssignmentTarget,
  Initializer,
}: ParseNode.AssignmentElement, value: Value, propertyName: PropertyKeyValue) {
  // 1. If DestructuringAssignmentTarget is neither an ObjectLiteral nor an ArrayLiteral, then
  let lref;
  if (DestructuringAssignmentTarget.type !== 'ObjectLiteral'
      && DestructuringAssignmentTarget.type !== 'ArrayLiteral') {
    // a. Let lref be the result of evaluating DestructuringAssignmentTarget.
    lref = Q(yield* Evaluate(DestructuringAssignmentTarget));
  }
  // 2. Let v be ? GetV(value, propertyName).
  const v = Q(yield* GetV(value, propertyName));
  // 3. If Initializer is present and v is undefined, then
  let rhsValue: Value;
  if (Initializer && v === Value.undefined) {
    // a. If IsAnonymousFunctionDefinition(Initializer) and IsIdentifierRef of DestructuringAssignmentTarget are both true, then
    if (IsAnonymousFunctionDefinition(Initializer) && IsIdentifierRef(DestructuringAssignmentTarget)) {
      // i. Let rhsValue be NamedEvaluation of Initializer with argument GetReferencedName(lref).
      rhsValue = Q(yield* NamedEvaluation(Initializer as FunctionDeclaration, (lref as ReferenceRecord).ReferencedName as JSStringValue));
    } else {
      // i. Let defaultValue be the result of evaluating Initializer.
      const defaultValue = Q(yield* Evaluate(Initializer));
      // ii. Let rhsValue be ? GetValue(defaultValue).
      rhsValue = Q(yield* GetValue(defaultValue));
    }
  } else { // 4. Else, let rhsValue be v.
    rhsValue = v;
  }
  // 5. If DestructuringAssignmentTarget is an ObjectLiteral or an ArrayLiteral, then
  if (DestructuringAssignmentTarget.type === 'ObjectLiteral'
      || DestructuringAssignmentTarget.type === 'ArrayLiteral') {
    // a. Let assignmentPattern be the AssignmentPattern that is covered by DestructuringAssignmentTarget.
    const assignmentPattern = refineLeftHandSideExpression(DestructuringAssignmentTarget) as ParseNode.ObjectAssignmentPattern | ParseNode.ArrayAssignmentPattern;
    // b. Return the result of performing DestructuringAssignmentEvaluation of assignmentPattern with rhsValue as the argument.
    return yield* DestructuringAssignmentEvaluation(assignmentPattern, X(rhsValue));
  }
  // 6. Return ? PutValue(lref, rhsValue).
  return Q(yield* PutValue(X(lref)!, rhsValue));
}

// ArrayAssignmentPattern :
//   `[` `]`
//   `[` AssignmentElementList `]`
//   `[` AssignmentElementList `,` AssignmentRestElement? `]`
function* DestructuringAssignmentEvaluation_ArrayAssignmentPattern({ AssignmentElementList, AssignmentRestElement }: ParseNode.ArrayAssignmentPattern, value: Value) {
  // 1. Let iteratorRecord be ? GetIterator(value).
  const iteratorRecord = Q(yield* GetIterator(value, 'sync'));
  // 2. Let status be IteratorDestructuringAssignmentEvaluation of AssignmentElementList with argument iteratorRecord.
  let status = EnsureCompletion(yield* IteratorDestructuringAssignmentEvaluation(AssignmentElementList, iteratorRecord));
  // 3. If status is an abrupt completion, then
  if (status instanceof AbruptCompletion) {
    // a. If iteratorRecord.[[Done]] is false, return ? IteratorClose(iteratorRecord, status).
    if (!iteratorRecord.Done) {
      return Q(yield* IteratorClose(iteratorRecord, status));
    }
    // b. Return Completion(status).
    return status;
  }
  // 4. If Elision is present, then
  // ...
  // 5. If AssignmentRestElement is present, then
  if (AssignmentRestElement) {
    // a. Set status to the result of performing IteratorDestructuringAssignmentEvaluation of AssignmentRestElement with iteratorRecord as the argument.
    status = EnsureCompletion(yield* IteratorDestructuringAssignmentEvaluation(AssignmentRestElement, iteratorRecord));
  }
  // 6. If iteratorRecord.[[Done]] is false, return ? IteratorClose(iteratorRecord, status).
  if (!iteratorRecord.Done) {
    return Q(yield* IteratorClose(iteratorRecord, status));
  }
  return Completion(status);
}

function* IteratorDestructuringAssignmentEvaluation(node: ParseNode.AssignmentElisionElement[] | ParseNode.AssignmentElisionElement | ParseNode.AssignmentRestElement, iteratorRecord: IteratorRecord): StatementEvaluator {
  if (Array.isArray(node)) {
    for (const n of node) {
      Q(yield* IteratorDestructuringAssignmentEvaluation(n, iteratorRecord));
    }
    return NormalCompletion(undefined);
  }
  switch (node.type) {
    case 'Elision':
      // 1. If iteratorRecord.[[Done]] is false, then
      if (!iteratorRecord.Done) {
        // a. Perform ? IteratorStep(iteratorRecord).
        Q(yield* IteratorStep(iteratorRecord));
      }
      // 2. Return NormalCompletion(empty).
      return NormalCompletion(undefined);
    case 'AssignmentElement': {
      const { DestructuringAssignmentTarget, Initializer } = node;
      let lref;
      // 1. If DestructuringAssignmentTarget is neither an ObjectLiteral nor an ArrayLiteral, then
      if (DestructuringAssignmentTarget.type !== 'ObjectLiteral'
          && DestructuringAssignmentTarget.type !== 'ArrayLiteral') {
        lref = Q(yield* Evaluate(DestructuringAssignmentTarget));
      }
      let value: Value = Value.undefined;
      // 2. If iteratorRecord.[[Done]] is false, then
      if (!iteratorRecord.Done) {
        // a. Let next be ? IteratorStepValue(iteratorRecord).
        const next = Q(yield* IteratorStepValue(iteratorRecord));
        // d. If next is not done, set value to next.
        if (next !== 'done') {
          value = next;
        }
      }
      let v: Value;
      // 4. If Initializer is present and value is undefined, then
      if (Initializer && value === Value.undefined) {
        // a. If IsAnonymousFunctionDefinition(AssignmentExpression) is true and IsIdentifierRef of LeftHandSideExpression is true, then
        if (IsAnonymousFunctionDefinition(Initializer) && IsIdentifierRef(DestructuringAssignmentTarget)) {
          // i. Let target be the StringValue of DestructuringAssignmentTarget.
          const target = (lref as ReferenceRecord).ReferencedName as JSStringValue;
          // i. ii. Let v be ? NamedEvaluation of Initializer with argument target.
          v = Q(yield* NamedEvaluation(Initializer as FunctionDeclaration, target));
        } else { // b. Else,
          // i. Let defaultValue be the result of evaluating Initializer.
          const defaultValue = Q(yield* Evaluate(Initializer));
          // ii. Let v be ? GetValue(defaultValue).
          v = Q(yield* GetValue(defaultValue));
        }
      } else { // 5. Else, let v be value.
        v = Q(value);
      }
      // 6. If DestructuringAssignmentTarget is an ObjectLiteral or an ArrayLiteral, then
      if (DestructuringAssignmentTarget.type === 'ObjectLiteral'
          || DestructuringAssignmentTarget.type === 'ArrayLiteral') {
        // a. Let nestedAssignmentPattern be the AssignmentPattern that is covered by DestructuringAssignmentTarget.
        const nestedAssignmentPattern = refineLeftHandSideExpression(DestructuringAssignmentTarget) as ParseNode.ObjectAssignmentPattern | ParseNode.ArrayAssignmentPattern;
        // b. Return the result of performing DestructuringAssignmentEvaluation of nestedAssignmentPattern with v as the argument.
        return yield* DestructuringAssignmentEvaluation(nestedAssignmentPattern, X(v));
      }
      // 7. Return ? PutValue(lref, v).
      return Q(yield* PutValue(Q(lref) as ReferenceRecord, v));
    }
    case 'AssignmentRestElement': {
      const { AssignmentExpression: DestructuringAssignmentTarget } = node;
      let lref;
      // 1. If DestructuringAssignmentTarget is neither an ObjectLiteral nor an ArrayLiteral, then
      if (DestructuringAssignmentTarget.type !== 'ObjectLiteral'
          && DestructuringAssignmentTarget.type !== 'ArrayLiteral') {
        lref = yield* Evaluate(DestructuringAssignmentTarget);
        Q(lref);
      }
      // 2. Let A be ! ArrayCreate(0).
      const array = X(ArrayCreate(0));
      // 3. Let n be 0.
      let n = 0;
      // 4. Repeat, while iteratorRecord.[[Done]] is false,
      while (!iteratorRecord.Done) {
        // a. Let next be IteratorStep(iteratorRecord).
        const next = Q(yield* IteratorStepValue(iteratorRecord));
        // d. If next is not done, then
        if (next !== 'done') {
          // i. Perform ! CreateDataPropertyOrThrow(A, ! ToString(𝔽(n)), next).
          X(CreateDataPropertyOrThrow(array, X(ToString(F(n))), X(next)));
          // v. Set n to n + 1.
          n += 1;
        }
      }
      // 5. If DestructuringAssignmentTarget is neither an ObjectLiteral nor an ArrayLiteral, then
      if (DestructuringAssignmentTarget.type !== 'ObjectLiteral'
          && DestructuringAssignmentTarget.type !== 'ArrayLiteral') {
        return Q(yield* PutValue(Q(lref) as ReferenceRecord, array));
      }
      // 6. Let nestedAssignmentPattern be the AssignmentPattern that is covered by DestructuringAssignmentTarget.
      const nestedAssignmentPattern = refineLeftHandSideExpression(DestructuringAssignmentTarget) as ParseNode.ObjectAssignmentPattern | ParseNode.ArrayAssignmentPattern;
      // 7. Return the result of performing DestructuringAssignmentEvaluation of nestedAssignmentPattern with A as the argument.
      return yield* DestructuringAssignmentEvaluation(nestedAssignmentPattern, array);
    }
    default:
      throw OutOfRange.nonExhaustive(node);
  }
}

export function DestructuringAssignmentEvaluation(node: ParseNode.ObjectAssignmentPattern | ParseNode.ArrayAssignmentPattern, value: Value): StatementEvaluator {
  switch (node.type) {
    case 'ObjectAssignmentPattern':
      return DestructuringAssignmentEvaluation_ObjectAssignmentPattern(node, value);
    case 'ArrayAssignmentPattern':
      return DestructuringAssignmentEvaluation_ArrayAssignmentPattern(node, value);
    default:
      throw OutOfRange.exhaustive(node);
  }
}
