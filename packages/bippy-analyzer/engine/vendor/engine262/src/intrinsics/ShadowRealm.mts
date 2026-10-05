import {
  Descriptor,
  UndefinedValue,
  Value,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  Assert,
  MakeRealm,
  isOrdinaryObject,
  OrdinaryCreateFromConstructor,
  Realm,
  Throw,
  type FunctionObject,
  type OrdinaryObject,
  type Mutable,
  isEvaluator,
  surroundingAgent,
} from '#self';

export interface ShadowRealmObject extends OrdinaryObject {
  readonly ShadowRealm: Realm;
}

export function isShadowRealmObject(value: Value): value is ShadowRealmObject {
  return 'ShadowRealm' in value;
}

/** https://tc39.es/proposal-shadowrealm/#sec-shadowrealm */
function* ShadowRealmConstructor(this: FunctionObject, _args: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  Q(surroundingAgent.debugger_cannotPreview);
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('ShadowRealm cannot be invoked without new');
  }
  const O = Q(yield* OrdinaryCreateFromConstructor(NewTarget, '%ShadowRealm.prototype%', ['ShadowRealm'])) as Mutable<ShadowRealmObject>;
  // Note: wait for https://github.com/tc39/ecma262/pull/3728
  const innerContext = Q(MakeRealm({
    name: 'ShadowRealm',
    specifier: surroundingAgent.currentRealmRecord.HostDefined.specifier,
  }));

  const realmRec = innerContext.Realm;
  O.ShadowRealm = realmRec;

  const hostHookCompletion = surroundingAgent.hostDefinedOptions.hostHooks?.HostInitializeShadowRealm?.(realmRec, innerContext, O);
  if (isEvaluator(hostHookCompletion)) {
    Q(yield* hostHookCompletion);
  } else {
    Q(hostHookCompletion);
  }

  Assert(isOrdinaryObject(realmRec.GlobalObject));
  return O;
}

export function bootstrapShadowRealm(realmRec: Realm) {
  const shadowRealmConstructor = bootstrapConstructor(realmRec, ShadowRealmConstructor, 'ShadowRealm', 0, realmRec.Intrinsics['%ShadowRealm.prototype%'], [
  ]);

  X(shadowRealmConstructor.DefineOwnProperty(Value('prototype'), Descriptor({
    Value: realmRec.Intrinsics['%ShadowRealm.prototype%'],
    Writable: true,
    Enumerable: false,
    Configurable: true,
  })));

  realmRec.Intrinsics['%ShadowRealm%'] = shadowRealmConstructor;
}
