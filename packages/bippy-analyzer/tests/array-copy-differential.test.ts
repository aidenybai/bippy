import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches native shallow copies, stable ordering and alias mutations, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const bounds = ["undefined", "NaN", "Infinity", "-Infinity", "-0", "-2.7", "1.8", "4"];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 50; index++) {
      const entries = Array.from(
        { length: 3 + getRandom(6) },
        (_, position) => `{ id: ${position}, rank: ${getRandom(3)}, value: ${getRandom(20)} }`,
      );
      const split = getRandom(entries.length + 1);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const values = [${entries.join(",")}];
      const nested = [values.slice(0, ${split}), values.slice(${split})];
      const flattened = nested.flat();
      const sorted = flattened.toSorted((left, right) => left.rank - right.rank);
      const reversed = flattened.toReversed();
      const window = flattened.slice(${bounds[getRandom(bounds.length)]}, ${bounds[getRandom(bounds.length)]});
      const combined = window.concat(sorted);
      sorted[${getRandom(entries.length)}].value += ${getRandom(10)};
      values.splice(${getRandom(entries.length)}, 1, { id: 99, rank: 9, value: 99 });
      flattened.push({ id: 100, rank: 9, value: 100 });
      const snapshot = (list) => list.map((item) => item.id + ':' + item.rank + ':' + item.value).join(',');
      return [values, nested[0], nested[1], flattened, sorted, reversed, window, combined].map(snapshot).join('|') + '#' + (values !== flattened) + ':' + (sorted !== flattened);
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each(
  [0, 1, 2].map((length) => ({
    length,
    label: `${length < 2 ? "known divergence: " : ""}toSorted copy storage at length ${length}`,
  })),
)("$label", ({ length }) => {
  const original = Array.from({ length }, (_, index) => index).join(",");
  const appended = [original, "9"].filter(Boolean).join(",");
  const testCase = {
    name: `toSorted length=${length}`,
    body: `const original = [${original}]; const copy = original.toSorted(); copy.push(9); return original.join(',') + '#' + copy.join(',') + '#' + (copy === original);`,
  };
  return length < 2
    ? checkKnownDifferentialWitnesses([
        {
          ...testCase,
          expected: `${original}#${appended}#false`,
          actual: JSON.stringify(`${appended}#${appended}#false`),
        },
      ])
    : checkDifferentialCases([testCase]);
});

it.each([
  {
    name: "flatMap consumes each returned array before the next callback mutates it",
    expected: "1,2",
    actual: JSON.stringify("2,2"),
    body: `const shared = [0]; const result = [1, 2].flatMap((value) => { shared[0] = value; return shared; }); return result.join(',');`,
  },
  {
    name: "flatMap observes each returned array length at callback time",
    expected: "1,1,2",
    actual: JSON.stringify("1,2,1,2"),
    body: `const shared = []; const result = [1, 2].flatMap((value) => { shared.push(value); return shared; }); return result.join(',');`,
  },
  {
    name: "flat with zero depth retains nested arrays",
    expected: "false,true",
    actual: JSON.stringify("false,false,true"),
    body: `const result = [1, [2, [3]]].flat(0); return result.map((value) => Array.isArray(value)).join(',');`,
  },
  {
    name: "flat with depth two removes two nested levels",
    expected: "false,false,false",
    actual: JSON.stringify("false,false,true"),
    body: `const result = [1, [2, [3]]].flat(2); return result.map((value) => Array.isArray(value)).join(',');`,
  },
  {
    name: "flat removes holes at flattened levels",
    expected: "1,2,3:3",
    actual: JSON.stringify("1,,2,,3:5"),
    body: `const result = [1, , [2, , 3]].flat(); return result.join(',') + ':' + result.length;`,
  },
  {
    name: "copyWithin handles rightward overlap",
    expected: "1,1,2,3",
    actual: JSON.stringify("1,2,3,4"),
    body: `const values = [1, 2, 3, 4]; values.copyWithin(1, 0, 3); return values.join(',');`,
  },
  {
    name: "copyWithin handles leftward overlap",
    expected: "2,3,4,4",
    actual: JSON.stringify("1,2,3,4"),
    body: `const values = [1, 2, 3, 4]; values.copyWithin(0, 1); return values.join(',');`,
  },
  {
    name: "fill normalizes fractional and negative bounds",
    expected: "1,9,9,4",
    actual: JSON.stringify("1,2,3,4"),
    body: `const values = [1, 2, 3, 4]; values.fill(9, 1.8, -1); return values.join(',');`,
  },
  {
    name: "slice converts string bounds",
    expected: "2,3",
    actual: "unknown(call of slice with dynamic bounds)",
    body: `return [1, 2, 3, 4].slice('1', '3').join(',');`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));
