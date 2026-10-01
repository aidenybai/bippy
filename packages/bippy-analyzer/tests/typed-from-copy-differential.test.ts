import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

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

const cases: DifferentialCase[] = constructors.flatMap((constructor) => {
  const observeCopy = `return [source.join(','), copy.join(','), copy.length, copy.byteLength, copy === source, Array.isArray(copy), ArrayBuffer.isView(copy)].join('|');`;
  return [
    ...[[], [1], [1, 2]].map((items) => ({
      name: `${constructor} independent source and copy writes, length ${items.length}`,
      body: `const source = ${JSON.stringify(items)}; const copy = ${constructor}.from(source); if (firstValue) { source.push(4); source[0] = 5; } if (secondValue && copy.length > 0) copy[0] = 6; ${observeCopy}`,
    })),
    {
      name: `${constructor} copies typed input independently`,
      body: `const source = new Uint8Array([1,2]); const copy = ${constructor}.from(source); if (firstValue) source[0] = 5; if (secondValue) copy[1] = 6; ${observeCopy}`,
    },
    {
      name: `${constructor} of does not retain apply argument storage`,
      body: `const source = [1,2]; const copy = ${constructor}.of.apply(${constructor}, source); if (firstValue) source.push(4); if (secondValue) copy[0] = 6; ${observeCopy}`,
    },
    {
      name: `${constructor} copies noniterable array-like input independently`,
      body: `const source = {0:1,1:2,length:2}; const copy = ${constructor}.from(source); if (firstValue) source[0] = 5; if (secondValue) copy[1] = 6; return [source[0], source[1], copy.join(','), copy.length, Array.isArray(copy), ArrayBuffer.isView(copy)].join('|');`,
    },
    {
      name: `${constructor} snapshots iterable values before overwrite and growth`,
      body: `const source = [1,2,3]; const events = []; const copy = ${constructor}.from(source, (value,index) => { events.push(index + ':' + value); if (index === 0 && firstValue) { source[1] = 8; source.push(4); } if (index === 1 && secondValue) { source[2] = 9; source.push(5); } return value + index; }); return [source.join(','), copy.join(','), events.join(','), copy.length].join('|');`,
    },
    {
      name: `${constructor} snapshots iterable values before truncation and shift`,
      body: `const source = [1,2,3]; const events = []; const copy = ${constructor}.from(source, (value,index) => { events.push(index + ':' + value); if (index === 0 && firstValue) source.length = 1; if (index === 0 && secondValue) source.shift(); return value + index; }); return [source.join(','), copy.join(','), events.join(','), copy.length].join('|');`,
    },
    {
      name: `${constructor} retains shallow payload aliases in the iterable snapshot`,
      body: `const source = [{value:1},{value:2}]; const copy = ${constructor}.from(source, (item,index) => { if (index === 0 && firstValue) source[1].value = 7; if (index === 0 && secondValue) source[1] = {value:8}; return item.value + index; }); return [source[0].value, source[1].value, copy.join(','), copy.length].join('|');`,
    },
    {
      name: `${constructor} snapshots selected iterable storage`,
      body: `const source = firstValue ? [1,2] : [3,4]; const copy = ${constructor}.from(source, (value,index) => { if (index === 0 && secondValue) source[1] = 9; return value + index; }); ${observeCopy}`,
    },
  ].map((testCase) => ({
    ...testCase,
    body: `const firstValue = first; const secondValue = second; ${testCase.body}`,
  }));
});

it.each(cases)("matches native typed copying and pinned replay for $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete typed-copy inputs for $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
