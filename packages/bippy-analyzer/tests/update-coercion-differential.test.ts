import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches native update references, numeric conversion and partial setter writes, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const inputs = [
      "-0",
      "NaN",
      "Infinity",
      "-Infinity",
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
    const failures = ["none", "base", "key", "get", "set-before", "set-after"];
    const operations = [
      "++getBase()[getKey()]",
      "getBase()[getKey()]++",
      "--getBase()[getKey()]",
      "getBase()[getKey()]--",
    ];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 60; index++) {
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [];
      const failure = '${failures[getRandom(failures.length)]}';
      let stored = ${inputs[getRandom(inputs.length)]};
      const mark = (phase) => { trace.push(phase); if (phase === failure) throw phase; };
      const replacement = { value: 'replacement' };
      const original = { get value() { mark('get'); ${getRandom(2) === 0 ? "holder = replacement;" : ""} return stored; }, set value(value) { mark('set-before'); stored = value; mark('set-after'); } };
      let holder = original;
      const getBase = () => { mark('base'); return holder; };
      const getKey = () => { mark('key'); return 'value'; };
      const describe = (value) => typeof value + ':' + (Object.is(value, -0) ? '-0' : String(value));
      let result;
      try { result = ${operations[getRandom(operations.length)]}; } catch (error) { result = 'caught:' + error; }
      return describe(result) + '#' + describe(stored) + '#' + trace.join('|') + '#' + replacement.value + '#' + (holder === original);
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "postfix returns a numeric primitive rather than the old object",
    expected: false,
    actual: "true",
    body: `const original = { valueOf: () => 7 }; let value = original; const previous = value++; return previous === original;`,
  },
  {
    name: "prefix preserves bigint from object conversion",
    expected: "bigint",
    actual: JSON.stringify("number"),
    body: `let value = { valueOf: () => 7n }; return typeof ++value;`,
  },
  {
    name: "postfix preserves bigint from object conversion",
    expected: "bigint",
    actual: JSON.stringify("object"),
    body: `let value = { valueOf: () => 7n }; return typeof value++;`,
  },
  {
    name: "throwing conversion prevents a setter call",
    expected: "get|convert|caught:conversion",
    actual: JSON.stringify("get|set|after"),
    body: `const trace = []; const original = { valueOf: () => { trace.push('convert'); throw 'conversion'; } }; const holder = { get value() { trace.push('get'); return original; }, set value(value) { trace.push('set'); } }; try { holder.value++; trace.push('after'); } catch (error) { trace.push('caught:' + (typeof error === 'string' ? error : error.name)); } return trace.join('|');`,
  },
  {
    name: "symbol conversion fails before setter failure",
    expected: "get|caught:TypeError",
    actual: JSON.stringify("get|set|caught:setter"),
    body: `const trace = []; const holder = { get value() { trace.push('get'); return Symbol('value'); }, set value(value) { trace.push('set'); throw 'setter'; } }; try { holder.value++; trace.push('after'); } catch (error) { trace.push('caught:' + (typeof error === 'string' ? error : error.name)); } return trace.join('|');`,
  },
  {
    name: "conversion reentrancy does not redirect the captured setter",
    expected: "get|convert|set:true:true",
    actual: JSON.stringify("get|set:true:false"),
    body: `const trace = []; const replacement = { value: 99 }; const input = { valueOf: () => { trace.push('convert'); current = replacement; return 7; } }; const original = { get value() { trace.push('get'); return input; }, set value(value) { trace.push('set:' + (this === original)); } }; let current = original; current.value++; return trace.join('|') + ':' + (current === replacement);`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));
