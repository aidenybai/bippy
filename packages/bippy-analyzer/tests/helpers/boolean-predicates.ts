export const booleanTermOrders = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

export const getBooleanMinterms = (mask: number, reversedTerms = 0): string[] =>
  Array.from({ length: 4 }, (_value, index) => index)
    .filter((index) => (mask & (1 << index)) !== 0)
    .map((index, termIndex) => {
      const firstFactor = index & 2 ? "inputFirst" : "!inputFirst";
      const secondFactor = index & 1 ? "inputSecond" : "!inputSecond";
      return reversedTerms & (1 << termIndex)
        ? `(${secondFactor} && ${firstFactor})`
        : `(${firstFactor} && ${secondFactor})`;
    });
