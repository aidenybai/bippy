import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
const targets = [
  { name: "local", setup: "let target=stored;", reference: "target", observation: "target" },
  {
    name: "index",
    setup: "const target=[stored];const getKey=()=>{trace.push('key');return 0;};",
    reference: "target[getKey()]",
    observation: "target[0]",
  },
  ...[false, true].flatMap((isInherited) =>
    ["'entry'", "Symbol.for('entry')"].map((key) => ({
      name: `accessor/inherited=${isInherited}/key=${key}`,
      setup: `const owner={};const target=${isInherited ? "Object.create(owner)" : "owner"};target.marker='target';const key=${key};const getKey=()=>{trace.push('key');return key;};Object.defineProperty(owner,key,{get(){trace.push('get:'+this.marker);return stored;},set(value){trace.push('set:'+this.marker);stored=value;writes++;if(secondValue)throw 'setter';}});`,
      reference: "target[getKey()]",
      observation: "stored",
    })),
  ),
];
const cases: DifferentialCase[] = targets.flatMap((target) =>
  ["++", "--"].flatMap((operator) =>
    [false, true].flatMap((isPrefix) =>
      [false, true].map((isSelected) => ({
        name: `${target.name}/${operator}/prefix=${isPrefix}/selected=${isSelected}`,
        body: `const firstValue=first;const secondValue=second;const trace=[];let writes=0;let stored=${isSelected ? "firstValue?Symbol('entry'):7" : "Symbol('entry')"};${target.setup}try{const result=${isPrefix ? operator + target.reference : target.reference + operator};trace.push('after:'+typeof result+':'+String(result));}catch(error){trace.push(typeof error==='string'?error:error.name+':'+error.message);}return trace.join('|')+':'+writes+':'+typeof ${target.observation};`,
      })),
    ),
  ),
);
it.each(cases)("matches native Symbol update completion and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete Symbol update inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
