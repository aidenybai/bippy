export const binaryOperators = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "==",
  "!=",
  "===",
  "!==",
  "<",
  "<=",
  ">",
  ">=",
  "&&",
  "||",
  "??",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
];

export const scalarLiterals = [
  "undefined",
  "null",
  "false",
  "true",
  "-0",
  "NaN",
  "Infinity",
  "1",
  "'1'",
  "''",
  "0n",
  "1n",
];

export const generatedInputs = ["first", "second", "third"];
export const generatedSeeds = [1, 0x5eed, 0xdeadbeef];

export interface ScalarProgram {
  seed: number;
  index: number;
  source: string;
}

export const getScalarPrograms = (seed: number): ScalarProgram[] => {
  let state = seed >>> 0;
  const getIndex = (length: number): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % length;
  };
  const getItem = (values: readonly string[]): string => values[getIndex(values.length)];
  const leaves = [...generatedInputs, ...scalarLiterals, "-1n", "2n", "'\\uD800'", "'text'"];
  const getExpression = (depth: number): string => {
    if (depth === 0) return getItem(leaves);
    switch (getIndex(6)) {
      case 0:
        return getItem(leaves);
      case 1:
        return `(${getItem(["+", "-", "!", "~", "typeof", "void"])} (${getExpression(depth - 1)}))`;
      case 2: {
        const operator = getItem(binaryOperators);
        const left = getExpression(depth - 1);
        const right = ["**", "<<", ">>", ">>>"].includes(operator)
          ? getItem(["0", "1", "2", "0n", "1n", "2n"])
          : getExpression(depth - 1);
        return `((${left}) ${operator} (${right}))`;
      }
      case 3:
        return `(${getExpression(depth - 1)} ? ${getExpression(depth - 1)} : ${getExpression(depth - 1)})`;
      case 4: {
        const input = getItem(generatedInputs);
        return `(${input} ? (${input} ? ${getExpression(depth - 1)} : (1n / 0n)) : (!${input} ? ${getExpression(depth - 1)} : (1n + 1)))`;
      }
      default:
        return `((${getExpression(depth - 1)}) ${getItem(["&&", "||", "??"])} (${getExpression(depth - 1)}))`;
    }
  };
  return Array.from({ length: 64 }, (_, index) => ({ seed, index, source: getExpression(4) }));
};
