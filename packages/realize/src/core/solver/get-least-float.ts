const INFINITY_KEY = 0x7ff0000000000000n;

const getKeyFloat = (key: bigint): number =>
  new Float64Array(
    new BigInt64Array([key < 0n ? BigInt.asIntN(64, -key | (1n << 63n)) : key]).buffer,
  )[0];

export const getLeastFloat = (isIncluded: (value: number) => boolean): number | null => {
  if (!isIncluded(Infinity)) return null;
  if (isIncluded(-Infinity)) return -Infinity;
  let excluded = -INFINITY_KEY;
  let included = INFINITY_KEY;
  while (included - excluded > 1n) {
    const middle = (excluded + included) / 2n;
    const isMiddleIncluded = isIncluded(getKeyFloat(middle));
    included = isMiddleIncluded ? middle : included;
    excluded = isMiddleIncluded ? excluded : middle;
  }
  return getKeyFloat(included);
};
