import { Value } from '../value.mts';
import { Q } from '../completion.mts';
import { Assert, RequireObjectCoercible, ToString, type PlainEvaluator } from '#self';

/** https://tc39.es/ecma262/#sec-trimstring */
export function* TrimString(arg: string | Value, where: 'start' | 'end' | 'start+end'): PlainEvaluator<string> {
  let string;
  if (typeof arg === 'string') string = arg;
  else {
    Q(RequireObjectCoercible(arg));
    string = Q(yield* ToString(arg));
  }
  let T;
  if (where === 'start') {
    T = string.trimStart();
  } else if (where === 'end') {
    T = string.trimEnd();
  } else {
    Assert(where === 'start+end');
    T = string.trim();
  }
  return T;
}
