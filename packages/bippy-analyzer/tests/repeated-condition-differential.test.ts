import { expect, it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkDifferentialCases,
  DifferentialMismatch,
} from "./helpers/differential-evaluator.js";

const cases = [false, true].flatMap((isReturn) =>
  [false, true].flatMap((negateOuter) =>
    [false, true].flatMap((negateInner) =>
      ["first", "!first", "second", "!second"].map((later) => {
        const name = `return=${isReturn}/outer=${negateOuter}/inner=${negateInner}/later=${later}`;
        const isKnown = !isReturn || later !== (negateInner ? "second" : "!second");
        const expected = [
          ...new Set(
            [false, true].flatMap((first) =>
              [false, true].map((second) => {
                const isOuter = negateOuter ? !first : first;
                const isInner = negateInner ? !second : second;
                if (isReturn && isOuter && isInner) return "1";
                const value = isOuter ? (isInner ? 5 : 1) : 2;
                const isLater =
                  later === "first"
                    ? first
                    : later === "!first"
                      ? !first
                      : later === "second"
                        ? second
                        : !second;
                return String(value + (isLater ? 8 : 0));
              }),
            ),
          ),
        ];
        return {
          name,
          isKnown,
          label: `${isKnown ? "known precision gap: " : ""}${name}`,
          expected,
          actual: isReturn ? "[ '1', '9', '10', '2' ]" : "[ '13', '9', '10', '5', '1', '2' ]",
          body: `let value = 0; if (${negateOuter ? "!first" : "first"}) { value = 1; if (${negateInner ? "!second" : "second"}) { ${isReturn ? "return String(value);" : "value += 4;"} } } else { value = 2; } if (${later}) value += 8; return String(value);`,
        };
      }),
    ),
  ),
);

it.each(cases)("$label", async ({ name, body, expected, actual, isKnown }) => {
  if (!isKnown) return checkSymbolicCases([{ name, body }]);
  const testCase = { name, body, expected, actual };
  const failure: unknown = await checkSymbolicCases([testCase]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual([testCase]);
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
