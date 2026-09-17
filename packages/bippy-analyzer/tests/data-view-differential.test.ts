import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface ViewMethod {
  suffix: string;
  width: number;
}

const methods: ViewMethod[] = [
  { suffix: "Int8", width: 1 },
  { suffix: "Uint8", width: 1 },
  { suffix: "Int16", width: 2 },
  { suffix: "Uint16", width: 2 },
  { suffix: "Int32", width: 4 },
  { suffix: "Uint32", width: 4 },
  { suffix: "Float32", width: 4 },
  { suffix: "Float64", width: 8 },
];

it.each(differentialSeeds)(
  "matches explicit-endian DataView read/write histories, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const values = [
      "0",
      "-0",
      "255",
      "256",
      "65536",
      "4294967297",
      "-32769",
      "0.1",
      "Infinity",
      "-Infinity",
    ];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 40; index++) {
      const statements: string[] = [];
      for (let step = 0; step < 12; step++) {
        const method = methods[step % methods.length];
        const offset = getRandom(17 - method.width);
        const littleEndian = (index + step) % 2 === 0;
        statements.push(
          `view.set${method.suffix}(${offset}, ${values[getRandom(values.length)]}, ${littleEndian}); result = view.get${method.suffix}(${offset}, ${littleEndian}); trace.push(Object.is(result, -0) ? '-0' : String(result));`,
        );
      }
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `const view = new DataView(new ArrayBuffer(16)); const trace = []; let result; ${statements.join("\n")} const bytes = []; for (let index = 0; index < 16; index++) bytes.push(view.getUint8(index)); return trace.join('|') + '#' + bytes.join(',') + '#' + view.byteLength;`,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "DataView writes are visible through a byte view",
    expected: 7,
    actual: "0",
    body: `const buffer = new ArrayBuffer(4); const view = new DataView(buffer); const bytes = new Uint8Array(buffer); view.setUint8(0, 7); return bytes[0];`,
  },
  {
    name: "two DataViews share the supplied buffer",
    expected: 7,
    actual: "0",
    body: `const buffer = new ArrayBuffer(4); const first = new DataView(buffer); const second = new DataView(buffer); first.setUint8(0, 7); return second.getUint8(0);`,
  },
  {
    name: "DataView exposes the supplied buffer identity",
    expected: true,
    actual: "false",
    body: `const buffer = new ArrayBuffer(4); return new DataView(buffer).buffer === buffer;`,
  },
  {
    name: "out-of-range writes throw without changing bytes",
    expected: "RangeError:9",
    actual: JSON.stringify("accepted:9"),
    body: `const view = new DataView(new ArrayBuffer(4)); view.setUint8(0, 9); let outcome = 'accepted'; try { view.setUint32(2, 7, true); } catch (error) { outcome = error.name; } return outcome + ':' + view.getUint8(0);`,
  },
  {
    name: "out-of-range reads throw RangeError",
    expected: "RangeError",
    actual: JSON.stringify("accepted"),
    body: `const view = new DataView(new ArrayBuffer(4)); try { view.getUint32(2, true); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "negative view offsets throw RangeError",
    expected: "RangeError",
    actual: JSON.stringify("accepted"),
    body: `try { new DataView(new ArrayBuffer(4), -1); return 'accepted'; } catch (error) { return error.name; }`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "bigint setters wrap at 64 bits with explicit byte order",
    body: `const view = new DataView(new ArrayBuffer(8)); view.setBigUint64(0, 18446744073709551617n, true); return String(view.getBigUint64(0, true)) + ':' + view.getUint8(0) + ':' + view.getUint8(7);`,
  },
  {
    name: "view offsets constrain the local read window",
    body: `const view = new DataView(new ArrayBuffer(8), 2, 4); view.setUint16(0, 258, false); return view.byteOffset + ':' + view.byteLength + ':' + view.getUint8(0) + ':' + view.getUint8(1);`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));

it.each([false, true])(
  "round-trips NaN without asserting its byte payload, littleEndian=%s",
  (littleEndian) =>
    checkDifferentialCases([
      {
        name: `NaN round trip/${littleEndian}`,
        body: `const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, NaN, ${littleEndian}); return Number.isNaN(view.getFloat64(0, ${littleEndian}));`,
      },
    ]),
);

interface ViewOffset {
  source: string;
  index: number;
}

const offsets: ViewOffset[] = [
  { source: "undefined", index: 0 },
  { source: "null", index: 0 },
  { source: "NaN", index: 0 },
  { source: "-Infinity", index: -Infinity },
  { source: "Infinity", index: Infinity },
  { source: "-1", index: -1 },
  { source: "-0.5", index: 0 },
  { source: "0", index: 0 },
  { source: "0.9", index: 0 },
  { source: "1", index: 1 },
  { source: "7", index: 7 },
  { source: "8", index: 8 },
];

const rangeCases = methods.flatMap((method) =>
  offsets.flatMap((offset) =>
    [false, true].map((isWrite) => {
      const isAllowed = offset.index >= 0 && offset.index + method.width <= 8;
      const operation = `${isWrite ? "set" : "get"}${method.suffix}`;
      const name = `${operation}/${offset.source}`;
      return {
        name,
        label: `${isAllowed ? "" : "known divergence: "}${name}`,
        isAllowed,
        body: `const view = new DataView(new ArrayBuffer(8)); view.setUint8(0, 7); let outcome = 'accepted'; try { view.${operation}(${offset.source}${isWrite ? ", 1" : ""}, true); } catch (error) { outcome = error.name; } return outcome + ':' + view.getUint8(0);`,
      };
    }),
  ),
);

it.each(rangeCases)("$label", ({ name, body, isAllowed }) =>
  isAllowed
    ? checkDifferentialCases([{ name, body }])
    : checkKnownDifferentialWitnesses([
        { name, body, expected: "RangeError:7", actual: JSON.stringify("accepted:7") },
      ]),
);
