import {
  ObjectValue,
  UndefinedValue,
  Value,
  wellKnownSymbols,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import {
  IfAbruptCloseIterator,
  Q,
  X,
  type ValueEvaluator,
} from '../completion.mts';
import { __ts_cast__, type Mutable } from '../utils/language.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import { surroundingAgent } from '#self';
import {
  Assert,
  Call,
  Construct,
  CreateArrayFromList,
  Get,
  GetIterator,
  GroupBy,
  IsCallable,
  IteratorClose,
  IteratorStepValue,
  OrdinaryCreateFromConstructor,
  Realm,
  Throw,
  type FunctionObject,
  type KeyedGroupRecord,
  type OrdinaryObject,
} from '#self';

export function* AddEntriesFromIterable(target: ObjectValue, iterable: Value, adder: FunctionObject): ValueEvaluator {
  Assert(iterable !== Value.undefined && iterable !== Value.null);
  const iteratorRecord = Q(yield* GetIterator(iterable, 'sync'));
  while (true) {
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    if (next === 'done') {
      return target;
    }
    if (!(next instanceof ObjectValue)) {
      const error = Throw.TypeError('$1 is not an object', next);
      return Q(yield* IteratorClose(iteratorRecord, error));
    }
    // e. Let k be Get(nextItem, "0").
  const k = yield* Get(next, '0');
    // f. IfAbruptCloseIterator(k, iteratorRecord).
    IfAbruptCloseIterator(k, iteratorRecord);
    __ts_cast__<Value>(k);
    // g. Let v be Get(nextItem, "1").
  const v = yield* Get(next, '1');
    // h. IfAbruptCloseIterator(v, iteratorRecord).
    IfAbruptCloseIterator(v, iteratorRecord);
    __ts_cast__<Value>(v);
    // i. Let status be Call(adder, target, « k, v »).
    const status = yield* Call(adder, target, [k, v]);
    // j. IfAbruptCloseIterator(status, iteratorRecord).
    IfAbruptCloseIterator(status, iteratorRecord);
  }
}

export interface MapObject extends OrdinaryObject {
  readonly MapData: { Key: Value | undefined, Value: Value | undefined }[];
}
export function isMapObject(value: Value): value is MapObject {
  return 'MapData' in value;
}
/** https://tc39.es/ecma262/#sec-map-iterable */
function* MapConstructor(this: FunctionObject, [iterable = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext) {
  // 1. If NewTarget is undefined, throw a TypeError exception.
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('Map cannot be invoked without new');
  }
  // 2. Let map be ? OrdinaryCreateFromConstructor(NewTarget, "%Map.prototype%", « [[MapData]] »).
  const map = Q(yield* OrdinaryCreateFromConstructor(NewTarget, '%Map.prototype%', ['MapData'])) as Mutable<MapObject>;
  // 3. Set map.[[MapData]] to a new empty List.
  map.MapData = [];
  // 4. If iterable is either undefined or null, return map.
  if (iterable === Value.undefined || iterable === Value.null) {
    return map;
  }
  // 5. Let adder be ? Get(map, "set").
  const adder = Q(yield* Get(map, 'set'));
  if (!IsCallable(adder)) {
    return Throw.TypeError('$1 is not a function', adder);
  }
  // 6. Return ? AddEntriesFromIterable(map, iterable, adder).
  return Q(yield* AddEntriesFromIterable(map, iterable, adder));
}

/** https://tc39.es/ecma262/#sec-map.groupby */
function* Map_groupBy([items = Value.undefined, callback = Value.undefined]: Arguments): ValueEvaluator {
  /*
  1. Let groups be ? GroupBy(items, callback, collection).
  2. Let map be ! Construct(%Map%).
  3. For each Record { [[Key]], [[Elements]] } g of groups, do
    a. Let elements be CreateArrayFromList(g.[[Elements]]).
    b. Let entry be the Record { [[Key]]: g.[[Key]], [[Value]]: elements }.
    c. Append entry to map.[[MapData]].
  4. Return map.
  */
  const groups: KeyedGroupRecord[] = Q(yield* GroupBy(items, callback, 'collection'));
  const map: MapObject = X(Construct(surroundingAgent.intrinsic('%Map%'))) as MapObject;
  for (const g of groups) {
    const elements = CreateArrayFromList(g.Elements);
    const entry = { Key: g.Key, Value: elements };
    map.MapData.push(entry);
  }
  return map;
}

/** https://tc39.es/ecma262/#sec-get-map-@@species */
function Map_speciesGetter(_args: Arguments, { thisValue }: FunctionCallContext) {
  // 1. Return the this value.
  return thisValue;
}

export function bootstrapMap(realmRec: Realm) {
  const mapConstructor = bootstrapConstructor(realmRec, MapConstructor, 'Map', 0, realmRec.Intrinsics['%Map.prototype%'], [
    ['groupBy', Map_groupBy, 2],
    [wellKnownSymbols.species, [Map_speciesGetter]],
  ]);

  realmRec.Intrinsics['%Map%'] = mapConstructor;
}
