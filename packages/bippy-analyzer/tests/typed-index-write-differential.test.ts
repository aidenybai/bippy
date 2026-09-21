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
const invalidKeys = [
  "2",
  "-1",
  "1.5",
  "NaN",
  "Infinity",
  "-Infinity",
  "'-0'",
  "4294967296",
  "9007199254740991",
  "1e21",
];
const namedKeys = ["01", "1.0", "+0", "1e0", "-01", "note"];
const cases: DifferentialCase[] = constructors.flatMap((constructor) =>
  [
    {
      name: "numeric storage and assignment result",
      body: `const assigned=values[0]=firstValue?257:-129;values[1]=secondValue?2.5:3.5;trace.push(String(assigned));`,
    },
    {
      name: "primitive scalar coercion",
      body: `const assigned=values[0]=firstValue?'257.9':'-0';values[1]=secondValue?null:undefined;trace.push(typeof assigned+':'+assigned);`,
    },
    {
      name: "floating boundaries",
      body: `values[0]=firstValue?-0:1e40;values[1]=secondValue?0.1:1e-46;`,
    },
    {
      name: "conversion error preserves write prefix",
      body: `values[0]=firstValue?1n:257;trace.push('first');values[1]=secondValue?Symbol('token'):3.5;trace.push('second');`,
    },
    {
      name: "prefix and postfix results before storage conversion",
      body: `values[0]=firstValue?255:127;values[1]=secondValue?255:127;const before=values[0]++;const after=++values[1];trace.push(before+':'+after);`,
    },
    {
      name: "compound result before storage conversion",
      body: `values[0]=firstValue?255:127;const assigned=values[0]+=secondValue?2:3;trace.push(String(assigned));`,
    },
    {
      name: "guarded write isolation",
      body: `if(firstValue)values[0]=secondValue?257:0.1;trace.push(String(values[0]));`,
    },
    {
      name: "base key and value evaluation order",
      body: `const getBase=()=>{trace.push('base');if(firstValue)throw new Error('base');return values;};const getKey=()=>{trace.push('key');if(secondValue)throw new Error('key');return 0;};const getValue=()=>{trace.push('value');return 1n;};getBase()[getKey()]=getValue();`,
    },
    {
      name: "numeric negative zero key",
      body: `values[-0]=firstValue?257:-129;if(secondValue)values[1]=3.5;`,
    },
    ...invalidKeys.map((key) => ({
      name: `invalid canonical key ${key}`,
      body: `const assigned=values[${key}]=firstValue?1n:secondValue?Symbol('token'):257;trace.push(String(assigned)+':'+String(values[${key}])+':'+Object.keys(values).join(','));`,
    })),
    ...namedKeys.map((key) => ({
      name: `noncanonical key ${key}`,
      body: `const key=${JSON.stringify(key)};const assigned=values[key]=firstValue?1n:secondValue?Symbol('token'):257;trace.push(typeof assigned+':'+String(values[key])+':'+Object.hasOwn(values,key));`,
    })),
  ].map((testCase) => ({
    name: `${constructor}/${testCase.name}`,
    body: `const firstValue=first;const secondValue=second;const values=${constructor}.of(1,2);const trace=[];try{${testCase.body}trace.push('after');}catch(error){trace.push(error.name+':'+error.message);}return Array.from(values,value=>Object.is(value,-0)?'-0':String(value)).join(',')+':'+values.length+':'+values.byteLength+':'+trace.join('|');`,
  })),
);
it.each(cases)("matches typed index writes and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches concrete typed index writes: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
