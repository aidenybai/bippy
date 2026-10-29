export const getNextDown = (value: number): number => {
  if (value === 0) return -Number.MIN_VALUE;
  const bits = new BigInt64Array(new Float64Array([value]).buffer);
  bits[0] += value > 0 ? -1n : 1n;
  return new Float64Array(bits.buffer)[0];
};
