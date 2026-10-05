import {
  Await,
  Completion,
  NormalCompletion,
  Q, X,
  EnsureCompletion,
  ReturnCompletion,
  ThrowCompletion,
} from '../completion.mts';
import { ExecutionContext } from '../execution-context/ExecutionContext.mts';
import {
  ObjectValue, Value,
} from '../value.mts';
import {
  Evaluate, type ValueEvaluator, type YieldEvaluator,
} from '../evaluator.mts';
import { __ts_cast__, type Mutable } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  Assert,
  AsyncGeneratorYield,
  CreateIteratorResultObject,
  OrdinaryObjectCreate,
  RequireInternalSlot,
  type IteratorRecord,
  type OrdinaryObject,
} from './all.mts';
import {
  RunCallerContext, RunSuspendedContext, Throw, runningExecutionContext, surroundingAgent, type ValueCompletion,
} from '#self';

/** https://tc39.es/ecma262/#sec-generator-objects */
export interface GeneratorObject extends OrdinaryObject {
  GeneratorState: 'suspendedStart' | 'suspendedYield' | 'executing' | 'completed' | undefined;
  GeneratorContext: ExecutionContext | null;
  readonly GeneratorBrand: string | undefined;
  UnderlyingIterators?: IteratorRecord[];
  // NON-SPEC
  HostCapturedValues?: readonly Value[];
}

/** https://tc39.es/ecma262/#sec-generatorstart */
export function GeneratorStart(generator: GeneratorObject, generatorBody: ParseNode.GeneratorBody | (() => YieldEvaluator)): undefined {
  // 1. Assert: The value of generator.[[GeneratorState]] is suspended-start.
  Assert(generator.GeneratorState === 'suspendedStart');
  // 2. Let genContext be the running execution context.
  const genContext = surroundingAgent.runningExecutionContext;
  // 3. Set the Generator component of genContext to generator.
  genContext.Generator = generator;
  // 4. Let closure be a new Abstract Closure with no parameters that captures generatorBody
  //    and performs the following steps when called:
  const closure = function* closure(): ValueEvaluator {
    // a. Let acGenContext be the running execution context.
    const acGenContext = surroundingAgent.runningExecutionContext;
    // b. Let acGenerator be the Generator component of acGenContext.
    const acGenerator = acGenContext.Generator as GeneratorObject;
    // c. If generatorBody is a Parse Node, then
    //   i. Let result be Completion(Evaluation of generatorBody).
    // d. Else,
    //   i. Assert: generatorBody is an Abstract Closure with no parameters.
    //   ii. Let result be generatorBody().
    const result = EnsureCompletion(
      // Note: Engine262 can only perform the "If generatorBody is an Abstract Closure" check:
      yield* typeof generatorBody === 'function'
        ? generatorBody()
        : Evaluate(generatorBody),
    );
    // e. Assert: If we return here, the generator either threw an exception or performed either
    //    an implicit or explicit return.
    // f. Remove acGenContext from the execution context stack and restore the execution context
    //    that is at the top of the execution context stack as the running execution context.
    surroundingAgent.executionContextStack.pop(acGenContext);
    // g. Set acGenerator.[[GeneratorState]] to completed.
    acGenerator.GeneratorState = 'completed';
    // h. NOTE: Once a generator enters the completed state it never leaves it and its associated execution context is never resumed. Any execution state associated with acGenerator can be discarded at this point.

    let resumption: ObjectValue | ThrowCompletion;
    if (result instanceof ThrowCompletion) {
      // i. If result is a throw completion, then
      //   i. Let resumption be result.
      resumption = result;
    } else {
      // j. Else,
      let resultValue: Value;
      if (result instanceof NormalCompletion) {
        // i. If result is a normal completion, then
        //   i. Let resultValue be undefined.
        resultValue = Value.undefined;
      } else {
        // ii. Else if result is a return completion, then
        //   1. Let resultValue be result.[[Value]].
        Assert(result instanceof ReturnCompletion);
        resultValue = result.Value;
      }
      // k. Let resumption be NormalCompletion(CreateIteratorResultObject(resultValue, true)).
      resumption = CreateIteratorResultObject(resultValue, true);
    }
    // l. Let callerContext be the running execution context.
    // m. Resume callerContext, passing resumption.
    yield { suspend: 'yield', value: resumption };
    // n. Assert: This step is never reached.
    Assert(false);
  };

  // 5. Set the code evaluation state of genContext such that when evaluation is resumed
  //    for that execution context, closure will be called with no arguments.
  genContext.CodeEvaluationState = (function* resumer() {
    return yield* closure();
  }());

  // 6. Set generator.[[GeneratorContext]] to genContext.
  generator.GeneratorContext = genContext;
  // 7. Return unused.
}

export function generatorBrandToErrorMessageType(generatorBrand: string | undefined) {
  let expectedType;
  if (generatorBrand !== undefined) {
    expectedType = generatorBrand;
    if (expectedType.startsWith('%') && expectedType.endsWith('Prototype%')) {
      expectedType = expectedType.slice(1, -10).trim();
      if (expectedType.endsWith('Iterator')) {
        expectedType = `${expectedType.slice(0, -8).trim()} Iterator`;
      }
    }
  }
  return expectedType;
}

/** https://tc39.es/ecma262/#sec-generatorvalidate */
export function GeneratorValidate(generator: Value, generatorBrand: string | undefined) {
  // 1. Perform ? RequireInternalSlot(generator, [[GeneratorState]]).
  Q(RequireInternalSlot(generator, 'GeneratorState'));
  // 2. Perform ? RequireInternalSlot(generator, [[GeneratorBrand]]).
  Q(RequireInternalSlot(generator, 'GeneratorBrand'));
  __ts_cast__<GeneratorObject>(generator);
  // 3. If generator.[[GeneratorBrand]] is not the same value as generatorBrand, throw a TypeError exception.
  const brand = generator.GeneratorBrand;
  if (brand !== generatorBrand) {
    return Throw.TypeError('$1 is not a $2 object', generator, generatorBrandToErrorMessageType(generatorBrand) || 'Generator');
  }
  // 4. Assert: generator also has a [[GeneratorContext]] internal slot.
  Assert('GeneratorContext' in generator);
  // 5. Let state be generator.[[GeneratorState]].
  const state = generator.GeneratorState;
  // 6. If state is executing, throw a TypeError exception.
  if (state === 'executing') {
    return Throw.TypeError('Cannot manipulate a running generator $1', generator);
  }
  // 7. Return state.
  return state;
}

/** https://tc39.es/ecma262/#sec-generatorresume */
export function* GeneratorResume(generator: Value, value: Value | undefined, generatorBrand: string | undefined): ValueEvaluator {
  // 1. Let state be ? GeneratorValidate(generator, generatorBrand).
  const state = Q(GeneratorValidate(generator, generatorBrand));
  __ts_cast__<GeneratorObject>(generator);
  // 2. If state is completed, return CreateIteratorResultObject(undefined, true).
  if (state === 'completed') {
    return X(CreateIteratorResultObject(Value.undefined, true));
  }
  // 3. Assert: state is either suspendedStart or suspendedYield.
  Assert(state === 'suspendedStart' || state === 'suspendedYield');
  // 4. Let genContext be generator.[[GeneratorContext]].
  const genContext = generator.GeneratorContext!;
  // 5. Set generator.[[GeneratorState]] to executing.
  generator.GeneratorState = 'executing';
  // 6. Return ? RunSuspendedContext(genContext, NormalCompletion(value)).
  const r = yield* RunSuspendedContext(genContext, { resume: 'yield', value });
  return r as ValueCompletion;
}

/** https://tc39.es/ecma262/#sec-generatorresumeabrupt */
export function* GeneratorResumeAbrupt(generator: Value, abruptCompletion: ThrowCompletion | ReturnCompletion, generatorBrand: string | undefined): ValueEvaluator {
  // 1. Let state be ? GeneratorValidate(generator, generatorBrand).
  let state = Q(GeneratorValidate(generator, generatorBrand));
  __ts_cast__<GeneratorObject>(generator);
  // 2. If state is suspendedStart, then
  if (state === 'suspendedStart') {
    // a. Set generator.[[GeneratorState]] to completed.
    generator.GeneratorState = 'completed';
    // b. Once a generator enters the completed state it never leaves it and its
    //    associated execution context is never resumed. Any execution state associate
    //    with generator can be discarded at this point.
    generator.GeneratorContext = null;
    // c. Set state to completed.
    state = 'completed';
  }
  // 3. If state is completed, then
  if (state === 'completed') {
    // a. If abruptCompletion.[[Type]] is return, then
    if (abruptCompletion.Type === 'return') {
      // i. Return CreateIteratorResultObject(abruptCompletion.[[Value]], true).
      return X(CreateIteratorResultObject(abruptCompletion.Value, true));
    }
    // b. Return Completion(abruptCompletion).
    return Completion(abruptCompletion);
  }
  // 4. Assert: state is suspendedYield.
  Assert(state === 'suspendedYield');
  // 5. Let genContext be generator.[[GeneratorContext]].
  const genContext = generator.GeneratorContext!;
  // 6. Set generator.[[GeneratorState]] to executing.
  generator.GeneratorState = 'executing';
  // 7. Return ? RunSuspendedContext(genContext, abruptCompletion).
  const r = yield* RunSuspendedContext(genContext, { resume: 'yield', value: abruptCompletion });
  return r as ValueCompletion;
}

/** https://tc39.es/ecma262/#sec-getgeneratorkind */
export function GetGeneratorKind(): 'async' | 'sync' | 'non-generator' {
  // 1. Let genContext be the running execution context.
  const genContext = surroundingAgent.runningExecutionContext;
  // 2. If genContext does not have a Generator component, return non-generator.
  if (!genContext.Generator) {
    return 'non-generator';
  }
  // 3. Let generator be the Generator component of genContext.
  const generator = genContext.Generator;
  // 4. If generator has an [[AsyncGeneratorState]] internal slot, return async.
  if ('AsyncGeneratorState' in generator) {
    return 'async';
  }
  // 5. Else, return sync.
  return 'sync';
}

/** https://tc39.es/ecma262/#sec-generatoryield */
export function* GeneratorYield(iteratorResult: ObjectValue): YieldEvaluator {
  const genContext = runningExecutionContext();
  // Assert: genContext is the execution context of a generator.
  Assert(genContext.Generator !== undefined);
  const gen = genContext.Generator as GeneratorObject;
  Assert(GetGeneratorKind() === 'sync');
  gen.GeneratorState = 'suspendedYield';
  return Q(yield* RunCallerContext({ suspend: 'yield', value: iteratorResult }));
}

/** https://tc39.es/ecma262/#sec-yield */
export function* Yield(value: Value): YieldEvaluator {
  // 1. Let generatorKind be GetGeneratorKind().
  const generatorKind = GetGeneratorKind();
  // 2. If generatorKind is async, return ? AsyncGeneratorYield(? Await(value)).
  if (generatorKind === 'async') {
    return Q(yield* AsyncGeneratorYield(Q(yield* Await(value))));
  }
  // 3. Otherwise, return ? GeneratorYield(CreateIteratorResultObject(value, false)).
  return Q(yield* GeneratorYield(CreateIteratorResultObject(value, false)));
}

/** https://tc39.es/ecma262/#sec-createiteratorfromclosure */
export function CreateIteratorFromClosure(closure: () => YieldEvaluator, generatorBrand: string | undefined, generatorPrototype: ObjectValue, extraSlots?: string[], enclosedValues?: readonly Value[]): Mutable<GeneratorObject> {
  Assert(typeof closure === 'function');
  // 1. NOTE: closure can contain uses of the Yield shorthand to yield an IteratorResult object.
  // 2. If extraSlots is not present, set extraSlots to a new empty List.
  extraSlots ??= [];
  // 3. Let internalSlotsList be the list-concatenation of extraSlots and « [[GeneratorState]], [[GeneratorContext]], [[GeneratorBrand]] ».
  const internalSlotsList = extraSlots.concat(['GeneratorState', 'GeneratorContext', 'GeneratorBrand']);
  // 4. Let generator be OrdinaryObjectCreate(generatorPrototype, internalSlotsList).
  const generator = OrdinaryObjectCreate(generatorPrototype, internalSlotsList) as Mutable<GeneratorObject>;
  // 5. Set generator.[[GeneratorBrand]] to generatorBrand.
  generator.GeneratorBrand = generatorBrand;
  // 6. Set generator.[[GeneratorState]] to suspended-start.
  generator.GeneratorState = 'suspendedStart';

  // NON-SPEC
  if (enclosedValues && extraSlots.includes('HostCapturedValues')) {
    generator.HostCapturedValues = enclosedValues.slice();
  }

  // 7. Let callerContext be the running execution context.
  const callerContext = surroundingAgent.runningExecutionContext;
  // 8. Let calleeContext be a new execution context.
  const calleeContext = new ExecutionContext();
  // 9. Set the Function of calleeContext to null.
  calleeContext.Function = Value.null;
  // 10. Set the Realm of calleeContext to the current Realm Record.
  calleeContext.Realm = surroundingAgent.currentRealmRecord;
  // 11. Set the ScriptOrModule of calleeContext to callerContext's ScriptOrModule.
  calleeContext.ScriptOrModule = callerContext.ScriptOrModule;
  calleeContext.HostDefined ??= {};
  calleeContext.HostDefined.scriptId = callerContext.HostDefined?.scriptId;
  // 12. If callerContext is not already suspended, suspend callerContext.
  // 13. Push calleeContext onto the execution context stack; calleeContext is now the running execution context.
  surroundingAgent.executionContextStack.push(calleeContext);
  // 14. Perform GeneratorStart(generator, closure).
  GeneratorStart(generator, closure);
  // 15. Remove calleeContext from the execution context stack and restore callerContext as the running execution context.
  surroundingAgent.executionContextStack.pop(calleeContext);
  // 16. Return generator.
  return generator;
}
