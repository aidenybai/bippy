import { Value } from '../value.mts';
import {
  NormalCompletion,
  Q, X,
} from '../completion.mts';
import { Evaluate, type PlainEvaluator } from '../evaluator.mts';
import {
  StringValue,
  IsAnonymousFunctionDefinition,
} from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { __ts_cast__ } from '../utils/language.mts';
import { NamedEvaluation, BindingInitialization } from './all.mts';
import {
  Assert,
  GetValue,
  InitializeReferencedBinding,
  IteratorStep,
  PutValue,
  ResolveBinding,
  ArrayCreate,
  CreateDataPropertyOrThrow,
  ToString,
  F,
  type IteratorRecord,

  IteratorStepValue,
  UndefinedValue, type EnvironmentRecord, type FunctionDeclaration,
} from '#self';

/** https://tc39.es/ecma262/#sec-function-definitions-runtime-semantics-iteratorbindinginitialization */
// FormalParameters :
//   [empty]
//   FormalParameterList `,` FunctionRestParameter
export function* IteratorBindingInitialization_FormalParameters(FormalParameters: ParseNode.FormalParameters, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | undefined) {
  if (FormalParameters.length === 0) {
    // 1. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  for (const FormalParameter of FormalParameters.slice(0, -1)) {
    Q(yield* IteratorBindingInitialization_FormalParameter(FormalParameter, iteratorRecord, environment));
  }

  const last = FormalParameters[FormalParameters.length - 1];
  if (last.type === 'BindingRestElement') {
    return yield* IteratorBindingInitialization_FunctionRestParameter(last, iteratorRecord, environment);
  }
  return yield* IteratorBindingInitialization_FormalParameter(last, iteratorRecord, environment);
}

// FormalParameter : BindingElement
function IteratorBindingInitialization_FormalParameter(BindingElement: ParseNode.FormalParametersElement, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | undefined) {
  // TODO
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return IteratorBindingInitialization_BindingElement(BindingElement as any, iteratorRecord, environment);
}

// FunctionRestParameter : BindingRestElement
function IteratorBindingInitialization_FunctionRestParameter(FunctionRestParameter: ParseNode.FunctionRestParameter, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | undefined) {
  return IteratorBindingInitialization_BindingRestElement(FunctionRestParameter, iteratorRecord, environment);
}

// BindingElement :
//   SingleNameBinding
//   BindingPattern
function IteratorBindingInitialization_BindingElement(BindingElement: ParseNode.BindingElement, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | undefined) {
  if ('BindingPattern' in BindingElement) {
    return IteratorBindingInitialization_BindingPattern(BindingElement, iteratorRecord, environment);
  }
  return IteratorBindingInitialization_SingleNameBinding(BindingElement, iteratorRecord, environment);
}

// SingleNameBinding : BindingIdentifier Initializer?
function* IteratorBindingInitialization_SingleNameBinding({ BindingIdentifier, Initializer }: ParseNode.SingleNameBinding, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | undefined): PlainEvaluator {
  // 1. Let bindingId be StringValue of BindingIdentifier.
  const bindingId = StringValue(BindingIdentifier);
  // 2. Let lhs be ? ResolveBinding(bindingId, environment).
  const lhs = Q(yield* ResolveBinding(bindingId, BindingIdentifier.strict, environment));
  let v: Value = Value.undefined;
  // 3. If iteratorRecord.[[Done]] is false, then
  if (!iteratorRecord.Done) {
    // a. Let next be ? IteratorStepValue(iteratorRecord).
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    // d. If next is not DONE,
    if (next !== 'done') {
      v = next;
    }
  }
  // 5. If Initializer is present and v is undefined, then
  if (Initializer && v === Value.undefined) {
    if (IsAnonymousFunctionDefinition(Initializer)) {
      v = Q(yield* NamedEvaluation(Initializer as FunctionDeclaration, bindingId));
    } else {
      const defaultValue = Q(yield* Evaluate(Initializer));
      v = Q(yield* GetValue(defaultValue));
    }
  }
  // 6. If environment is undefined, return ? PutValue(lhs, v).
  if (!environment) {
    return Q(yield* PutValue(lhs, v));
  }
  // 7. Return InitializeReferencedBinding(lhs, v).
  return yield* InitializeReferencedBinding(lhs, X(v));
}

// BindingRestElement :
//   `...` BindingIdentifier
//   `...` BindingPattern
function* IteratorBindingInitialization_BindingRestElement({ BindingIdentifier, BindingPattern }: ParseNode.BindingRestElement, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | undefined) {
  if (BindingIdentifier) {
    // 1. Let lhs be ? ResolveBinding(StringValue of BindingIdentifier, environment).
    const lhs = Q(yield* ResolveBinding(StringValue(BindingIdentifier), BindingIdentifier.strict, environment));
    // 2. Let A be ! ArrayCreate(0).
    const array = X(ArrayCreate(0));
    // 3. Let n be 0.
    let n = 0;
    // 4. Repeat,
    while (true) {
      let next: 'done' | Value = 'done';
      // a. If iteratorRecord.[[Done]] is false, then
      if (!iteratorRecord.Done) {
        // i. Let next be ? IteratorStepValue(iteratorRecord).
        next = Q(yield* IteratorStepValue(iteratorRecord));
      }
      if (next === 'done') {
        // i. If environment is undefined, return ? PutValue(lhs, A).
        if (!environment) {
          return Q(yield* PutValue(lhs, array));
        }
        // ii. Return InitializeReferencedBinding(lhs, A).
        return yield* InitializeReferencedBinding(lhs, array);
      }
      // f. Perform ! CreateDataPropertyOrThrow(A, ! ToString(𝔽(n)), next).
      X(CreateDataPropertyOrThrow(array, X(ToString(F(n))), next));
      // g. Set n to n + 1.
      n += 1;
    }
  } else {
    // 1. Let A be ! ArrayCreate(0).
    const array = X(ArrayCreate(0));
    // 2. Let n be 0.
    let n = 0;
    // 3. Repeat,
    while (true) {
      let next: 'done' | Value = 'done';
      // a. If iteratorRecord.[[Done]] is false, then
      if (!iteratorRecord.Done) {
        // i. Let next be ? IteratorStepValue(iteratorRecord).
        next = Q(yield* IteratorStepValue(iteratorRecord));
      }
      // b. If next is done, then
      if (next === 'done') {
        // i. Return the result of performing BindingInitialization of BindingPattern with A and environment as the arguments.
        return yield* BindingInitialization(BindingPattern!, array, environment);
      }
      // f. Perform ! CreateDataPropertyOrThrow(A, ! ToString(𝔽(n)), next).
      X(CreateDataPropertyOrThrow(array, X(ToString(F(n))), Q(next)));
      // g. Set n to n + 1.
      n += 1;
    }
  }
}

function* IteratorBindingInitialization_BindingPattern({ BindingPattern, Initializer }: ParseNode.BindingElement, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | undefined) {
  let v: Value = Value.undefined;
  // 1. If iteratorRecord.[[Done]] is false, then
  if (!iteratorRecord.Done) {
    // a. Let next be ? IteratorStepValue(iteratorRecord).
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    if (next !== 'done') {
      v = next;
    }
  }
  // 3. If Initializer is present and v is undefined, then
  if (Initializer && v instanceof UndefinedValue) {
    // a. Let defaultValue be the result of evaluating Initializer.
    const defaultValue = Q(yield* Evaluate(Initializer));
    // b. Set v to ? GetValue(defaultValue).
    v = Q(yield* GetValue(defaultValue));
  }
  // 4. Return the result of performing BindingInitialization of BindingPattern with v and environment as the arguments.
  return yield* BindingInitialization(BindingPattern, X(v), environment);
}

function* IteratorDestructuringAssignmentEvaluation(node: ParseNode.Elision, iteratorRecord: IteratorRecord): PlainEvaluator {
  Assert(node.type === 'Elision');
  // 1. If iteratorRecord.[[Done]] is false, then
  if (!iteratorRecord.Done) {
    // a. Perform ? IteratorStep(iteratorRecord).
    Q(yield* IteratorStep(iteratorRecord));
  }
  // 2. Return NormalCompletion(empty).
  return NormalCompletion(undefined);
}

export function* IteratorBindingInitialization_ArrayBindingPattern({ BindingElementList, BindingRestElement }: ParseNode.ArrayBindingPattern, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | undefined): PlainEvaluator {
  for (const BindingElement of BindingElementList) {
    if (BindingElement.type === 'Elision') {
      Q(yield* IteratorDestructuringAssignmentEvaluation(BindingElement, iteratorRecord));
    } else {
      // TODO
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Q(yield* IteratorBindingInitialization_BindingElement(BindingElement as any, iteratorRecord, environment));
    }
  }

  if (BindingRestElement) {
    return Q(yield* IteratorBindingInitialization_BindingRestElement(BindingRestElement, iteratorRecord, environment));
  }
  return NormalCompletion(undefined);
}
