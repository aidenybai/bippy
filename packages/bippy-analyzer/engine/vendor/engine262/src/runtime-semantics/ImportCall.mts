import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import {
  Q, X, IfAbruptRejectPromise,
} from '../completion.mts';
import {
  AbstractModuleRecord, AllImportAttributesSupported, Call, CyclicModuleRecord, EnumerableOwnProperties, Get, JSStringValue, ObjectValue, Realm, Value, type ImportAttributeRecord, type ModuleRequestRecord, type PromiseObject, type ScriptRecord,
} from '../index.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { __ts_cast__ } from '../utils/language.mts';
import {
  surroundingAgent, HostLoadImportedModule,
  GetValue,
  ToString,
  NewPromiseCapability,
  GetActiveScriptOrModule,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-import-calls */
// ImportCall : `import` `(` AssignmentExpression `)`
export function* Evaluate_ImportCall(ImportCall: ParseNode.ImportCall): ValueEvaluator<PromiseObject> {
  Q(surroundingAgent.debugger_cannotPreview);
  return yield* EvaluateImportCall(ImportCall.AssignmentExpression, ImportCall.Phase, ImportCall.OptionsExpression);
}

/** https://tc39.es/ecma262/#sec-evaluate-import-call */
function* EvaluateImportCall(
  specifiersExpression: ParseNode.AssignmentExpressionOrHigher,
  phase: 'source' | 'defer' | 'evaluation',
  optionsExpression: undefined | ParseNode.AssignmentExpressionOrHigher,
): ValueEvaluator<PromiseObject> {
  // 1. Let referrer be ! GetActiveScriptOrModule().
  let referrer: null | AbstractModuleRecord | ScriptRecord | Realm = GetActiveScriptOrModule();
  // 2. If referrer is null, set referrer to the current Realm Record.
  if (referrer === null) {
    referrer = surroundingAgent.currentRealmRecord;
  }
  // 3. Let specifierRef be ? Evaluation of AssignmentExpression.
  const specifierRef = Q(yield* Evaluate(specifiersExpression));
  // 4. Let specifier be ? GetValue(specifierRef).
  const specifier = Q(yield* GetValue(specifierRef));
  let options: Value;
  // 5. If optionsExpression is present, then
  if (optionsExpression) {
    // a. Let optionsRef be ? Evaluation of optionsExpression.
    const optionsRef = Q(yield* Evaluate(optionsExpression));
    // b. Let options be ? GetValue(optionsRef).
    options = Q(yield* GetValue(optionsRef));
  } else { // 6. Else,
    // a. Let options be undefined.
    options = Value.undefined;
  }
  // 7. Let promiseCapability be ! NewPromiseCapability(%Promise%).
  const promiseCapability = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
  // 8. Let specifierString be ToString(specifier).
  const specifierString = yield* ToString(specifier);
  // 9. IfAbruptRejectPromise(specifierString, promiseCapability).
  IfAbruptRejectPromise(specifierString, promiseCapability);
  __ts_cast__<string>(specifierString);
  // 10. Let attributes nw a new empty List.
  const attributes: ImportAttributeRecord[] = [];
  // 11. If options is not undefined, then
  if (options !== Value.undefined) {
    // a. If options is not an Object, then
    if (!(options instanceof ObjectValue)) {
      // i. Perform ! Call(promiseCapability.[[Reject]], undefined, « a newly created TypeError object »).
      X(Call(promiseCapability.Reject, Value.undefined, [
        Throw.TypeError('The second argument to import() must be an object, but $1', options).Value,
      ]));
      // ii. Return promiseCapability.[[Promise]].
      return promiseCapability.Promise;
    }
    // b. Let attributesObj be Completion(Get(options, "with")).
    const attributesObj = yield* Get(options, 'with');
    // c. IfAbruptRejectPromise(attributesObj, promiseCapability).
    IfAbruptRejectPromise(attributesObj, promiseCapability);
    __ts_cast__<Value>(attributesObj);
    // d. If attributesObj is not undefined, then
    if (attributesObj !== Value.undefined) {
      // i. If attributesObj is not an Object, then
      if (!(attributesObj instanceof ObjectValue)) {
        // 1. Perform ! Call(promiseCapability.[[Reject]], undefined, « a newly created TypeError object »).
        X(Call(promiseCapability.Reject, Value.undefined, [
          Throw.TypeError('The "with" option in import() must be an object, but $1', attributesObj).Value,
        ]));
        // 2. Return promiseCapability.[[Promise]].
        return promiseCapability.Promise;
      }
      // ii. Let entries be Completion(EnumerableOwnProperties(attributesObj, key+value)).
      const entries = yield* EnumerableOwnProperties(attributesObj, 'key+value');
      // iii. IfAbruptRejectPromise(entries, promiseCapability).
      IfAbruptRejectPromise(entries, promiseCapability);
      __ts_cast__<ObjectValue[]>(entries);
      // iv. For each element entry of entries, do
      for (const entry of entries) {
        // 1. Let key be ! Get(entry, "0").
        const key = Q(yield* Get(entry, '0'));
        // 2. Let value be ! Get(entry, "1").
        const value = Q(yield* Get(entry, '1'));
        // 3. If key is a String, then
        if (key instanceof JSStringValue) {
          // a. If value is not a String, then
          if (!(value instanceof JSStringValue)) {
            // i. Perform ! Call(promiseCapability.[[Reject]], undefined, « a newly created TypeError object »).
            X(Call(promiseCapability.Reject, Value.undefined, [
              Throw.TypeError('Import attribute value must be a string, but $1', value).Value,
            ]));
            // ii. Return promiseCapability.[[Promise]].
            return promiseCapability.Promise;
          }
          // b. Append the ImportAttribute Record { [[Key]]: key, [[Value]]: value } to attributes.
          attributes.push({ Key: key.value, Value: value.value });
        }
      }
      // e. If AllImportAttributesSupported(attributes) is false, then
      const unsupportedAttributeKey = AllImportAttributesSupported(attributes);
      if (unsupportedAttributeKey) {
        // i. Perform ! Call(promiseCapability.[[Reject]], undefined, « a newly created TypeError object »).
        X(Call(promiseCapability.Reject, Value.undefined, [
          Throw.TypeError('Unsupported import attribute "$1"', unsupportedAttributeKey).Value,
        ]));
        // ii. Return promiseCapability.[[Promise]].
        return promiseCapability.Promise;
      }
      // f. Sort attributes according to the lexicographic order of their [[Key]] field, treating the value of each such field as a sequence of UTF-16 code unit values.
      attributes.sort((a, b) => (a.Key < b.Key ? -1 : 1));
    }
  }
  // 12. Let moduleRequest be a new ModuleRequest Record { [[Specifier]]: specifierString, [[Attributes]]: attributes }.
  const moduleRequest: ModuleRequestRecord = {
    Specifier: specifierString, Attributes: attributes, Phase: phase, ImportedNames: 'all',
  };
  // 10. Perform HostLoadImportedModule(referrer, specifierString, ~empty~, promiseCapability).
  HostLoadImportedModule(referrer as CyclicModuleRecord | ScriptRecord | Realm, moduleRequest, undefined, { data: promiseCapability });
  // 9. Return promiseCapability.[[Promise]].
  return promiseCapability.Promise;
}
