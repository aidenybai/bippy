import { __ts_cast__ } from '../utils/language.mts';
import { PerformShadowRealmEval, ShadowRealmImportValue, ValidateShadowRealmObject } from '../abstract-ops/shadow-realm.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { type ShadowRealmObject } from './ShadowRealm.mts';
import {
  Realm, Throw,
} from '#self';
import {
  JSStringValue, Q, surroundingAgent, ToString, Value, type Arguments, type FunctionCallContext, type ValueEvaluator,
} from '#self';

/** https://tc39.es/proposal-shadowrealm/#sec-shadowrealm.prototype.evaluate */
function* ShadowRealmPrototype_evaluate([sourceText = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  Q(surroundingAgent.debugger_cannotPreview);
  const O = thisValue;
  Q(ValidateShadowRealmObject(O));
  __ts_cast__<ShadowRealmObject>(O);
  if (!(sourceText instanceof JSStringValue)) {
    return Throw.TypeError('$1 is not a string', sourceText);
  }
  const callerRealm = surroundingAgent.currentRealmRecord;
  const evalRealm = O.ShadowRealm;
  return Q(yield* PerformShadowRealmEval(sourceText.stringValue(), callerRealm, evalRealm));
}

/** https://tc39.es/proposal-shadowrealm/#sec-shadowrealm.prototype.importvalue */
function* ShadowRealmPrototype_importValue([specifier = Value.undefined, exportName = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  Q(surroundingAgent.debugger_cannotPreview);
  const O = thisValue;
  Q(ValidateShadowRealmObject(O));
  __ts_cast__<ShadowRealmObject>(O);
  const specifierString = Q(yield* ToString(specifier));
  if (!(exportName instanceof JSStringValue)) {
    return Throw.TypeError('$1 is not a string', exportName);
  }
  const callerRealm = surroundingAgent.currentRealmRecord;
  const evalRealm = O.ShadowRealm;
  return ShadowRealmImportValue(specifierString, exportName.stringValue(), callerRealm, evalRealm);
}

export function bootstrapShadowRealmPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['evaluate', ShadowRealmPrototype_evaluate, 1],
    ['importValue', ShadowRealmPrototype_importValue, 2],
  ], realmRec.Intrinsics['%Object.prototype%'], 'ShadowRealm');
  realmRec.Intrinsics['%ShadowRealm.prototype%'] = proto;
}
