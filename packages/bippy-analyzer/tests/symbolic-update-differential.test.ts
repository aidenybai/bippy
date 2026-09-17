import { expect, it } from "vite-plus/test";
import {
  checkSymbolicCases,
  createSeededRandom,
  differentialSeeds,
  DifferentialMismatch,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches native fork-local updates across primitive numeric types, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const inputs = [
      "-0",
      "NaN",
      "Infinity",
      "undefined",
      "null",
      "false",
      "true",
      "'5'",
      "''",
      "7",
      "0n",
      "7n",
    ];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 10; index++) {
      const selected = Array.from({ length: 4 }, () => inputs[getRandom(inputs.length)]);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const describe = (value) => typeof value + ':' + (Object.is(value, -0) ? '-0' : String(value));
      const sample = (initial) => { let value = initial; const previous = value++; return describe(previous) + '/' + describe(value); };
      if (first) { if (second) return sample(${selected[0]}); return sample(${selected[1]}); }
      if (second) return sample(${selected[2]});
      return sample(${selected[3]});
    `,
      });
    }
    await checkSymbolicCases(cases);
  },
);

it.each([
  {
    name: "merged strings are converted before postfix returns",
    body: "let value = first ? '1' : '2'; const previous = value++; return typeof previous + ':' + previous + ':' + value;",
  },
  {
    name: "merged bigint primitives retain their types and values",
    body: "let value = first ? 1n : 2n; const previous = value++; return typeof previous + ':' + String(previous) + ':' + typeof value + ':' + String(value);",
  },
])("preserves $name", (testCase) => checkSymbolicCases([testCase]));

it.each([
  {
    name: "conditional symbol updates retain the exceptional state",
    expected: ["ok", "TypeError"],
    actual: "[ 'ok' ]",
    body: "let value = first ? Symbol('value') : 7; let outcome = 'ok'; try { value++; } catch (error) { outcome = error.name; } return outcome;",
  },
  {
    name: "conditional mixed bigint writes retain the exceptional state",
    expected: ["ok:1", "TypeError:0"],
    actual: "[ 'ok:1' ]",
    body: "let writes = 0; const holder = { get value() { return first ? 1n : 1; }, set value(value) { writes++; } }; let outcome = 'ok'; try { holder.value += 1; } catch (error) { outcome = error.name; } return outcome + ':' + writes;",
  },
  {
    name: "conditional boxed bigint updates retain both numeric types",
    expected: ["number", "bigint"],
    actual: "[ 'number' ]",
    body: "let value = first ? { valueOf: () => 7n } : { valueOf: () => 7 }; return typeof ++value;",
  },
])("known divergence: $name", async ({ name, body, expected, actual }) => {
  const failure: unknown = await checkSymbolicCases([{ name, body }]).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch)
    expect(failure.actual).toEqual([{ name, body, expected, actual }]);
});
