import { Value } from '../value.mts';
import { Q } from '../completion.mts';
import {
  Assert, ToString, ToLength, R,
  type PlainEvaluator,
} from '#self';

/** https://tc39.es/ecma262/#sec-stringpad */
export function* StringPad(_string: string | Value, maxLength: Value, fillString: Value, placement: 'start' | 'end'): PlainEvaluator<string> {
  Assert(placement === 'start' || placement === 'end');
  let string;
  if (typeof _string === 'string') string = _string;
  else {
    string = Q(yield* ToString(_string));
  }
  const intMaxLength = R(Q(yield* ToLength(maxLength)));
  const stringLength = string.length;
  if (intMaxLength <= stringLength) {
    return string;
  }
  let filler;
  if (fillString === Value.undefined) {
    filler = ' ';
  } else {
    filler = Q(yield* ToString(fillString));
  }
  if (filler === '') {
    return string;
  }
  const fillLen = intMaxLength - stringLength;
  const stringFiller = filler.repeat(Math.ceil(fillLen / filler.length));
  const truncatedStringFiller = stringFiller.slice(0, fillLen);
  if (placement === 'start') {
    return truncatedStringFiller + string;
  } else {
    return string + truncatedStringFiller;
  }
}
