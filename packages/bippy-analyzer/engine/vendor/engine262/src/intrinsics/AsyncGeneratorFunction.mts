import { Q, X } from '../completion.mts';
import { CreateDynamicFunction } from '../runtime-semantics/all.mts';
import { Descriptor, Value } from '../value.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import { surroundingAgent } from '#self';
import type {
  Arguments, ValueEvaluator, FunctionCallContext, FunctionObject, Realm,
} from '#self';

/** https://tc39.es/ecma262/#sec-asyncgeneratorfunction */
function* AsyncGeneratorFunctionConstructor(args: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  const bodyArg = args[args.length - 1] || Value('');
  args = args.slice(0, -1) as Arguments;
  // 1. Let C be the active function object.
  const activeFunc = surroundingAgent.activeFunctionObject as FunctionObject;
  // 2. Let args be the argumentsList that was passed to this function by [[Call]] or [[Construct]].
  // 3. Return ? CreateDynamicFunction(C, NewTarget, asyncGenerator, args).
  return Q(yield* CreateDynamicFunction(activeFunc, NewTarget, 'asyncGenerator', args, bodyArg));
}

export function bootstrapAsyncGeneratorFunction(realmRec: Realm) {
  const cons = bootstrapConstructor(realmRec, AsyncGeneratorFunctionConstructor, 'AsyncGeneratorFunction', 1, realmRec.Intrinsics['%AsyncGeneratorFunction.prototype%'], []);

  X(cons.DefineOwnProperty(Value('prototype'), Descriptor({
    Writable: false,
    Enumerable: false,
    Configurable: false,
  })));

  X((realmRec.Intrinsics['%AsyncGeneratorFunction.prototype%']).DefineOwnProperty(Value('constructor'), Descriptor({
    Writable: false,
    Enumerable: false,
    Configurable: true,
  })));

  cons.Prototype = realmRec.Intrinsics['%Function%'];

  realmRec.Intrinsics['%AsyncGeneratorFunction%'] = cons;
}
