import type { PrimitiveValue } from "../types";

type PureFunction = (...values: PrimitiveValue[]) => PrimitiveValue;

const MATH_METHODS = ["abs", "ceil", "floor", "max", "min", "round", "sign", "trunc"] as const;

const PURE_FUNCTIONS = new Map<string, PureFunction>([
  ...MATH_METHODS.map((method): [string, PureFunction] => [
    `Math.${method}`,
    (...values) => (Math[method] as (...numbers: number[]) => number)(...values.map(Number)),
  ]),
  ["Number", (value) => Number(value)],
  ["String", (value) => String(value)],
  [
    "parseInt",
    (value, radix) => parseInt(String(value), radix === undefined ? undefined : Number(radix)),
  ],
  ["parseFloat", (value) => parseFloat(String(value))],
  ["Array.includes", (value, ...elements) => elements.includes(value)],
  ["Array.indexOf", (value, ...elements) => elements.indexOf(value)],
  ["String.concat.length", (...values) => values.map(String).join("").length],
]);

export const isPureFunction = (name: string): boolean => PURE_FUNCTIONS.has(name);

export const applyPureFunction = (name: string, values: PrimitiveValue[]): PrimitiveValue | null =>
  PURE_FUNCTIONS.get(name)?.(...values) ?? null;

const MAX_PURE_CALLS = 32;

export const applyPureFunctionToCases = (
  name: string,
  operandCases: PrimitiveValue[][],
): PrimitiveValue[] | null => {
  let combinations: PrimitiveValue[][] = [[]];
  for (const cases of operandCases) {
    if (combinations.length * cases.length > MAX_PURE_CALLS) return null;
    combinations = combinations.flatMap((values) => cases.map((value) => [...values, value]));
  }
  const results: PrimitiveValue[] = [];
  for (const values of combinations) {
    const result = applyPureFunction(name, values);
    if (result === null) return null;
    results.push(result);
  }
  return results;
};
