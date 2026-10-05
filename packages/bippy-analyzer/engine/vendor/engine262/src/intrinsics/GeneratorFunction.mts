import {
  Descriptor, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { CreateDynamicFunction } from '../runtime-semantics/all.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import { surroundingAgent } from '#self';
import { DefinePropertyOrThrow, type FunctionObject, Realm } from '#self';

/** https://tc39.es/ecma262/#sec-generatorfunction */
function* GeneratorFunctionConstructor(args: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  const bodyArg = args[args.length - 1] || Value('');
  args = args.slice(0, -1) as Arguments;
  // 1. Let C be the active function object.
  const activeFunc = surroundingAgent.activeFunctionObject as FunctionObject;
  // 2. Let args be the argumentsList that was passed to this function by [[Call]] or [[Construct]].
  // 3. Return ? CreateDynamicFunction(C, NewTarget, generator, args).
  return Q(yield* CreateDynamicFunction(activeFunc, NewTarget, 'generator', args, bodyArg));
}

export function bootstrapGeneratorFunction(realmRec: Realm) {
  const generator = realmRec.Intrinsics['%GeneratorFunction.prototype%'];

  const cons = bootstrapConstructor(realmRec, GeneratorFunctionConstructor, 'GeneratorFunction', 1, generator, []);

  X(DefinePropertyOrThrow(cons, 'prototype', Descriptor({
    Writable: false,
    Configurable: false,
  })));

  X(DefinePropertyOrThrow(generator, 'constructor', Descriptor({
    Writable: false,
  })));

  cons.Prototype = realmRec.Intrinsics['%Function%'];

  realmRec.Intrinsics['%GeneratorFunction%'] = cons;
}
