import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const cases: DifferentialCase[] = ["pop", "shift"]
  .flatMap((method) => [
    ...[0, 1, 2, 3].flatMap((length) => {
      const items = Array.from({ length }, (_value, index) => index + 1);
      return [
        {
          name: `${method} after guarded resize of length ${length}`,
          body: `const source = ${JSON.stringify(items)}; if (firstValue) source.length = ${Math.min(1, length)}; let removed = 'skipped'; if (secondValue) removed = source.${method}(); return [typeof removed, String(removed), source.length, source.join(',')].join('|');`,
        },
        {
          name: `${method} after guarded append to length ${length}`,
          body: `const source = ${JSON.stringify(items)}; if (firstValue) source.push(7); let removed = 'skipped'; if (secondValue) removed = source.${method}(); return [typeof removed, String(removed), source.length, source.join(',')].join('|');`,
        },
      ];
    }),
    {
      name: `${method} preserves removed payload identity and aliases`,
      body: `const item = {value:1}; const source = [item]; const alias = source; if (firstValue) alias.push(item); const removed = alias.${method}(); if (secondValue) removed.value = 9; return [removed === item, source === alias, item.value, source.length, source[0] === item].join('|');`,
    },
    {
      name: `${method} after correlated append and resize`,
      body: `const source = [1,2]; if (firstValue) source.push(3); if (firstValue) source.length = 1; const removed = source.${method}(); if (secondValue) source.push(9); return [String(removed), source.length, source.join(',')].join('|');`,
    },
  ])
  .map((testCase) => ({
    ...testCase,
    body: `const firstValue = first; const secondValue = second; ${testCase.body}`,
  }));

it.each(cases)("matches native finite removal and pinned replay for $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete finite-removal inputs for $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
