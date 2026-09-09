const spliceFinite = [1, 2, 3, 4, 5];
const removedFinite = spliceFinite.splice(1, 2);

const spliceOmitted = [1, 2, 3, 4, 5];
const removedOmitted = spliceOmitted.splice(2);

const spliceInfinite = [1, 2, 3, 4, 5];
const removedInfinite = spliceInfinite.splice(1, Number.POSITIVE_INFINITY);

const spliceFractional = [1, 2, 3, 4, 5];
const removedFractional = spliceFractional.splice(1.9, "2.5" as unknown as number);

const spliceNegative = [1, 2, 3, 4, 5];
const removedNegative = spliceNegative.splice(-2, Number.NaN, 9);

const source = [1, 2, 3];
const copied = Array.from(source);
copied.splice(0, Number.POSITIVE_INFINITY, 7);

const codes = [String.fromCharCode(72, 105), String.fromCodePoint(0x1f600), String.fromCharCode()];

const enumerated: number[] = [];
for (const value of Array.from({ length: 300 }, (_, index) => index)) {
  enumerated.push(value);
}

const text = "word ".repeat(100);
let cursor = 0;
let spaces = 0;
while (cursor < text.length) {
  if (text.charCodeAt(cursor) === 32) spaces++;
  cursor++;
}

const describe = (label: string, values: readonly (number | string)[]): string =>
  `${label}:${values.join(",")}`;

const facts = [
  describe("finite", spliceFinite),
  describe("finite-removed", removedFinite),
  describe("omitted", spliceOmitted),
  describe("omitted-removed", removedOmitted),
  describe("infinite", spliceInfinite),
  describe("infinite-removed", removedInfinite),
  describe("fractional", spliceFractional),
  describe("fractional-removed", removedFractional),
  describe("negative", spliceNegative),
  describe("negative-removed", removedNegative),
  describe("source", source),
  describe("copied", copied),
  describe("codes", codes),
  `enumerated:${enumerated.length},${enumerated[0]},${enumerated[299]}`,
  `scanned:${cursor},${spaces}`,
];

export const isExact = true;

export default function ListSpliceAndCopies() {
  return (
    <ul>
      {facts.map((fact) => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  );
}
