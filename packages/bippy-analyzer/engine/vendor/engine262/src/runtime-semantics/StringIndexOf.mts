import { Assert, F, isNonNegativeInteger } from '#self';

// https://tc39.es/proposal-string-replaceall/#sec-stringindexof
export function StringIndexOf(string: string, searchValue: string, fromIndex: number) {
  // 1. Assert: Type(string) is String.
  Assert(typeof string === 'string');
  // 2. Assert: Type(searchValue) is String.
  Assert(typeof searchValue === 'string');
  // 3. Assert: fromIndex is a non-negative integer.
  Assert(isNonNegativeInteger(fromIndex));
  const stringStr = string;
  const searchStr = searchValue;
  // 4. Let len be the length of string.
  const len = stringStr.length;
  // 5. If searchValue is the empty string, and fromIndex <= len, return 𝔽(fromIndex).
  if (searchStr === '' && fromIndex <= len) {
    return F(fromIndex);
  }
  // 6. Let searchLen be the length of searchValue.
  const searchLen = searchStr.length;
  // 7. If there exists any integer k such that fromIndex ≤ k ≤ len - searchLen and for all nonnegative integers j less than searchLen,
  //    the code unit at index k + j within string is the same as the code unit at index j within searchValue, let pos be the smallest (closest to -∞) such integer.
  //    Otherwise, let pos be -1.
  let k = fromIndex;
  let pos = -1;
  while (k + searchLen <= len) {
    let match = true;
    for (let j = 0; j < searchLen; j += 1) {
      if (searchStr[j] !== stringStr[k + j]) {
        match = false;
        break;
      }
    }
    if (match) {
      pos = k;
      break;
    }
    k += 1;
  }
  // 8. Return 𝔽(pos).
  return F(pos);
}
