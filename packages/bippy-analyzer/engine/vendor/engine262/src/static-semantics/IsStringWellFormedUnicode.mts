import { X } from '../completion.mts';
import { CodePointAt } from './all.mts';

export function IsStringWellFormedUnicode(string: string) {
  // 1. Let _strLen_ be the number of code units in string.
  const strLen = string.length;
  // 2. Let k be 0.
  let k = 0;
  // 3. Repeat, while k ≠ strLen,
  while (k !== strLen) {
    // a. Let cp be ! CodePointAt(string, k).
    const cp = X(CodePointAt(string, k));
    // b. If cp.[[IsUnpairedSurrogate]] is true, return false.
    if (cp.IsUnpairedSurrogate) {
      return false;
    }
    // c. Set k to k + cp.[[CodeUnitCount]].
    k += cp.CodeUnitCount;
  }
  // 4. Return true.
  return true;
}
