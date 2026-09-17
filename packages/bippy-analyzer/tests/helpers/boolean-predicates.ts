export const booleanTermOrders = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

const sharedFailingOrders = new Set(["012", "102", "120", "210"]);
export const knownLeftAssociatedOrders = new Map([
  [7, sharedFailingOrders],
  [11, new Set(["012", "021", "102", "201"])],
  [13, new Set(["021", "120", "201", "210"])],
  [14, sharedFailingOrders],
]);

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
