import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches default Reflect.get receivers and Reflect.has lookup, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      const initial = getRandom(30);
      const inherited = getRandom(30);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [];
      const prototype = { inherited: ${inherited}, get doubled() { trace.push('get:' + this.own); return this.own * 2; } };
      const target = Object.create(prototype); target.own = ${initial};
      const own = Reflect.get(target, 'own'); const inherited = Reflect.get(target, 'inherited');
      const doubled = Reflect.get(target, 'doubled');
      const presence = ['own', 'inherited', 'doubled', 'missing'].map((key) => Reflect.has(target, key)).join(',');
      return own + ':' + inherited + ':' + doubled + '#' + presence + '#' + trace.join('|');
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "Reflect.get uses an explicit getter receiver",
    expected: 7,
    actual: "1",
    body: `const target = { value: 1, get read() { return this.value; } }; return Reflect.get(target, 'read', { value: 7 });`,
  },
  {
    name: "Reflect.get forwards primitive receivers without boxing in strict getters",
    expected: true,
    actual: "false",
    body: `const target = { get read() { return this === 7; } }; return Reflect.get(target, 'read', 7);`,
  },
  {
    name: "Reflect.get forwards undefined when explicitly supplied as receiver",
    expected: true,
    actual: "false",
    body: `const target = { get read() { return this === undefined; } }; return Reflect.get(target, 'read', undefined);`,
  },
  {
    name: "Reflect.get rejects primitive targets instead of boxing them",
    expected: "TypeError",
    actual: "3",
    body: `try { return Reflect.get('abc', 'length'); } catch (error) { return error.name; }`,
  },
  {
    name: "Reflect.get accepts symbol keys",
    expected: 7,
    actual: "unknown(Reflect.get with a dynamic key)",
    body: `const key = Symbol('key'); return Reflect.get({ [key]: 7 }, key);`,
  },
  {
    name: "Reflect.get converts object keys before lookup",
    expected: "string:7",
    actual: "<string: + on dynamic values>",
    body: `const trace = []; const key = { [Symbol.toPrimitive](hint) { trace.push(hint); return 'value'; } }; const result = Reflect.get({ value: 7 }, key); return trace.join('|') + ':' + result;`,
  },
  {
    name: "Reflect.get validates the target before converting a key",
    expected: "TypeError",
    actual: "<string: join of a list with an unknown length>",
    body: `const trace = []; const key = { [Symbol.toPrimitive]() { trace.push('key'); throw 'key'; } }; try { Reflect.get(7, key); trace.push('after'); } catch (error) { trace.push(error.name); } return trace.join('|');`,
  },
  {
    name: "Reflect.get passes the explicit receiver to a proxy trap",
    expected: "value:true",
    actual: 'branch("value:true" | "value:false")',
    body: `const receiver = {}; const trace = []; const target = new Proxy({}, { get(target, key, observed) { trace.push(key + ':' + (observed === receiver)); return 7; } }); Reflect.get(target, 'value', receiver); return trace.join('|');`,
  },
  {
    name: "Reflect.set creates a receiver property rather than changing the target",
    expected: "1:7",
    actual: '"1:undefined"',
    body: `const target = { value: 1 }; const receiver = {}; Reflect.set(target, 'value', 7, receiver); return target.value + ':' + receiver.value;`,
  },
  {
    name: "Reflect.set invokes an inherited setter with the receiver",
    expected: "receiver:7",
    actual: '""',
    body: `const trace = []; const prototype = { set value(value) { trace.push(this.marker + ':' + value); } }; const target = Object.create(prototype); Reflect.set(target, 'value', 7, { marker: 'receiver' }); return trace.join('|');`,
  },
  {
    name: "Reflect.set returns false for a nonwritable data property",
    expected: false,
    actual: "unknown(Reflect.set())",
    body: `const target = {}; Object.defineProperty(target, 'value', { value: 1 }); return Reflect.set(target, 'value', 7);`,
  },
  {
    name: "Reflect.has rejects primitive targets",
    expected: "TypeError",
    actual: "unknown(Reflect.has on a dynamic target)",
    body: `try { return Reflect.has('abc', 'length'); } catch (error) { return error.name; }`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "Reflect.has does not invoke property getters",
    body: `const trace = []; const target = { get value() { trace.push('get'); throw 'get'; } }; return Reflect.has(target, 'value') + ':' + trace.join('|');`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
