import { Q } from '../completion.mts';
import { CreateDynamicFunction } from '../runtime-semantics/all.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import { surroundingAgent } from '#self';
import {
  type Arguments, type ValueEvaluator, type FunctionCallContext, type FunctionObject, type Realm,
  Value,
} from '#self';

/** https://tc39.es/ecma262/#sec-function-p1-p2-pn-body */
function* FunctionConstructor(args: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  const bodyArg = args[args.length - 1] || Value('');
  args = args.slice(0, -1) as Arguments;
  // 1. Let C be the active function object.
  const activeFunc = surroundingAgent.activeFunctionObject as FunctionObject;
  // 2. Let args be the argumentsList that was passed to this function by [[Call]] or [[Construct]].
  // 3. Return ? CreateDynamicFunction(C, NewTarget, normal, args).
  return Q(yield* CreateDynamicFunction(activeFunc, NewTarget, 'normal', args, bodyArg));
}

export function bootstrapFunction(realmRec: Realm) {
  const cons = bootstrapConstructor(realmRec, FunctionConstructor, 'Function', 1, realmRec.Intrinsics['%Function.prototype%'], []);
  realmRec.Intrinsics['%Function%'] = cons;
}
