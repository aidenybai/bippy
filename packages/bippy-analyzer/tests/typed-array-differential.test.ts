import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches native representable typed-array values and slice copies, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const constructors = [
      "Int8Array",
      "Uint8Array",
      "Uint8ClampedArray",
      "Int16Array",
      "Uint16Array",
      "Int32Array",
      "Uint32Array",
      "Float32Array",
      "Float64Array",
    ];
    const inputs = ["0", "1", "7", "63", "127"];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 50; index++) {
      const entries = Array.from({ length: getRandom(9) }, () => inputs[getRandom(inputs.length)]);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const original = new ${constructors[index % constructors.length]}([${entries.join(",")}]);
      const copy = original.slice(${getRandom(9) - 4}, ${getRandom(9) - 4});
      if (copy.length) copy[0] = 7;
      const describe = (value) => Object.is(value, -0) ? '-0' : String(value);
      return Array.from(original).map(describe).join(',') + '#' + Array.from(copy).map(describe).join(',') + '#' + original.byteLength + '#' + (original === copy);
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "indexed writes perform integer conversion",
    expected: 1,
    body: `const values = new Uint8Array([0]); values[0] = 257; return values[0];`,
  },
  {
    name: "clamped writes use ties-to-even",
    expected: "2,4",
    body: `const values = new Uint8ClampedArray([0, 0]); values[0] = 2.5; values[1] = 3.5; return values.join(',');`,
  },
  {
    name: "out-of-bounds writes do not extend a typed array",
    expected: "1:undefined",
    body: `const values = new Uint8Array([1]); values[2] = 7; return values.length + ':' + String(values[2]);`,
  },
  {
    name: "set converts values to the target element type",
    expected: 1,
    body: `const values = new Uint8Array([0]); values.set([257]); return values[0];`,
  },
  {
    name: "set rejects an oversized source before writing",
    expected: "RangeError",
    body: `const values = new Uint8Array([1]); try { values.set([2, 3]); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "set rejects a negative offset",
    expected: "RangeError",
    body: `const values = new Uint8Array([1]); try { values.set([2], -1); return 'accepted'; } catch (error) { return error.name; }`,
  },
])("matches native typed-array writes: $name", (testCase) => {
  expect(runInNewContext(`(()=>{${testCase.body}})()`, {}, { timeout: 1000 })).toBe(
    testCase.expected,
  );
  return checkDifferentialCases([testCase]);
});

it.each([
  {
    name: "subarray writes are visible in the original",
    expected: "1,7,3:7,3",
    actual: JSON.stringify("1,2,3:7,3"),
    body: `const values = new Uint8Array([1, 2, 3]); const view = values.subarray(1); view[0] = 7; return values.join(',') + ':' + view.join(',');`,
  },
  {
    name: "views over one buffer share bytes",
    expected: 7,
    actual: "0",
    body: `const buffer = new ArrayBuffer(2); const first = new Uint8Array(buffer); const second = new Uint8Array(buffer); first[0] = 7; return second[0];`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "set snapshots an overlapping source",
    body: `const values = new Uint8Array([1, 2, 3, 4]); values.set(values.subarray(0, 3), 1); return values.join(',');`,
  },
  {
    name: "float64 construction retains nonfinite values and negative zero",
    body: `const values = new Float64Array([-0, NaN, Infinity]); return Object.is(values[0], -0) + ':' + String(values[1]) + ':' + values[2];`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));

it.each([
  {
    name: "float32 constructor rounds to element precision",
    expected: 0.10000000149011612,
    body: `return new Float32Array([0.1])[0];`,
  },
  {
    name: "uint8 constructor converts integer elements",
    expected: "255,0,1,0",
    body: `return new Uint8Array([-1, 256, 257, NaN]).join(',');`,
  },
  {
    name: "clamped constructor rounds ties to even",
    expected: "2,4",
    body: `return new Uint8ClampedArray([2.5, 3.5]).join(',');`,
  },
])("matches native constructor conversion: $name", (testCase) => {
  expect(runInNewContext(`(()=>{${testCase.body}})()`, {}, { timeout: 1000 })).toBe(
    testCase.expected,
  );
  return checkDifferentialCases([testCase]);
});
