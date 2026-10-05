import { CodePointAt } from './all.mts';

/** https://tc39.es/ecma262/#sec-stringtocodepoints */
export function StringToCodePoints(string: string) {
  // 1. Let codePoints be a new empty List.
  const codePoints = [];
  // 2. Let size be the length of string.
  const size = string.length;
  // 3. Let position be 0.
  let position = 0;
  // 4. Repeat, while position < size,
  while (position < size) {
    // a. Let cp be ! CodePointAt(string, position).
    const cp = CodePointAt(string, position);
    // b. Append cp.[[CodePoint]] to codePoints.
    codePoints.push(cp.CodePoint);
    // c. Set position to position + cp.[[CodeUnitCount]].
    position += cp.CodeUnitCount;
  }
  // 5. Return codePoints.
  return codePoints;
}
