import { it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkGuardedCases,
  checkDifferentialCases,
} from "./helpers/differential-evaluator.js";

const cases = [false, true].flatMap((isReturn) =>
  [false, true].flatMap((negateOuter) =>
    [false, true].flatMap((negateInner) =>
      ["first", "!first", "second", "!second"].map((later) => ({
        name: `return=${isReturn}/outer=${negateOuter}/inner=${negateInner}/later=${later}`,
        body: `let value = 0; if (${negateOuter ? "!first" : "first"}) { value = 1; if (${negateInner ? "!second" : "second"}) { ${isReturn ? "return String(value);" : "value += 4;"} } } else { value = 2; } if (${later}) value += 8; return String(value);`,
      })),
    ),
  ),
);

it.each(cases)("preserves repeated conditions: $name", async (testCase) => {
  await checkGuardedCases([testCase]);
  await checkSymbolicCases([testCase]);
});

it.each(cases)("matches concrete repeated-predicate pins $name", (testCase) =>
  checkDifferentialCases(
    [false, true].flatMap((first) =>
      [false, true].map((second) => ({
        name: `${testCase.name}/first=${first}/second=${second}`,
        body: `const first = ${first}; const second = ${second}; ${testCase.body}`,
      })),
    ),
  ),
);
