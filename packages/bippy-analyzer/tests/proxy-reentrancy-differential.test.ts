import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkExpectedDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches native trap replacement and reentrant receiver access, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 40; index++) {
      const key = getRandom(2) === 0 ? "value" : "tail";
      const actions = [`trace.push('read:' + proxy.${key});`, `proxy.${key} = ${getRandom(20)};`];
      if (getRandom(2) === 0) actions.reverse();
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [];
      const target = { value: ${getRandom(20)}, tail: ${getRandom(20)} };
      const handler = {
        get(target, key, receiver) {
          trace.push('outer-get:' + key);
          handler.get = (target, key) => { trace.push('inner-get:' + key); return target[key] + 10; };
          return receiver.tail + target[key];
        },
        set(target, key, value, receiver) {
          trace.push('outer-set:' + key);
          handler.set = (target, key, value) => { trace.push('inner-set:' + key); target[key] = value; return true; };
          receiver.tail = value + 1;
          target[key] = value;
          return true;
        },
      };
      const proxy = new Proxy(target, handler);
      ${actions.join("\n")}
      trace.push('last:' + proxy.value);
      return trace.join('|') + '#' + target.value + ':' + target.tail;
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "apply lookup effects without observing the return value",
    expected: "lookup,apply",
    actual: JSON.stringify(""),
    body: `const trace = []; const proxy = new Proxy(() => 1, { get apply() { trace.push('lookup'); return () => { trace.push('apply'); return 2; }; } }); proxy(); return trace.join(',');`,
  },
  {
    name: "construct lookup effects without observing the instance",
    expected: "lookup,construct",
    actual: JSON.stringify(""),
    body: `const trace = []; class Target {} const proxy = new Proxy(Target, { get construct() { trace.push('lookup'); return () => { trace.push('construct'); return {}; }; } }); new proxy(); return trace.join(',');`,
  },
  {
    name: "apply trap getter",
    expected: "13|lookup,apply",
    actual: "<string: + on dynamic values>",
    body: `const trace = []; const proxy = new Proxy((value) => value + 1, { get apply() { trace.push('lookup'); return (target, receiver, args) => { trace.push('apply'); return target(...args) + 10; }; } }); const result = proxy(2); return result + '|' + trace.join(',');`,
  },
  {
    name: "construct trap getter",
    expected: "12|lookup",
    actual: "<string: + on dynamic values>",
    body: `const trace = []; class Target { constructor(value) { trace.push('body'); this.value = value; } } const proxy = new Proxy(Target, { get construct() { trace.push('lookup'); return (target, args) => ({ value: args[0] + 10 }); } }); const result = new proxy(2); return result.value + '|' + trace.join(',');`,
  },
  {
    name: "throwing apply getter",
    expected: "caught:lookup",
    actual: 'unknown(call of accessor property "apply")',
    body: `const proxy = new Proxy(() => 'called', { get apply() { throw 'lookup'; } }); try { return proxy(); } catch (error) { return 'caught:' + error; }`,
  },
  {
    name: "apply handler is itself a proxy",
    expected: "12|lookup:apply",
    actual: "<string: + on dynamic values>",
    body: `const trace = []; const handler = new Proxy({}, { get(target, key) { trace.push('lookup:' + key); return (target, receiver, args) => args[0] + 10; } }); const proxy = new Proxy((value) => value, handler); return proxy(2) + '|' + trace.join(',');`,
  },
  {
    name: "get invariant for frozen data",
    expected: "TypeError",
    actual: JSON.stringify("value:2"),
    body: `const target = {}; Object.defineProperty(target, 'value', { value: 1 }); const proxy = new Proxy(target, { get: () => 2 }); try { return 'value:' + proxy.value; } catch (error) { return error.name; }`,
  },
  {
    name: "delete invariant for non-configurable data",
    expected: "TypeError",
    actual: JSON.stringify("true"),
    body: `const target = {}; Object.defineProperty(target, 'value', { value: 1 }); const proxy = new Proxy(target, { deleteProperty: () => true }); try { return String(delete proxy.value); } catch (error) { return error.name; }`,
  },
  {
    name: "duplicate ownKeys invariant",
    expected: "TypeError",
    actual: "unknown(call of Reflect.ownKeys on a dynamic target)",
    body: `const proxy = new Proxy({}, { ownKeys: () => ['value', 'value'] }); try { return Reflect.ownKeys(proxy).join(','); } catch (error) { return error.name; }`,
  },
])("known divergence: respects $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it("enforces the has invariant for non-configurable data", () =>
  checkExpectedDifferentialCases([
    {
      name: "has invariant for non-configurable data",
      expected: "TypeError",
      body: `const target = {}; Object.defineProperty(target, 'value', { value: 1 }); const proxy = new Proxy(target, { has: () => false }); try { return String('value' in proxy); } catch (error) { return error.name; }`,
    },
  ]));

it.each([
  {
    name: "data-property apply trap",
    body: `const trace = []; const proxy = new Proxy((value) => value + 1, { apply: (target, receiver, args) => { trace.push('apply'); return target(...args) + 10; } }); const result = proxy(2); return result + '|' + trace.join(',');`,
  },
  {
    name: "data-property construct trap",
    body: `const trace = []; class Target { constructor() { trace.push('body'); } } const proxy = new Proxy(Target, { construct: (target, args) => { trace.push('construct'); return { value: args[0] + 10 }; } }); const result = new proxy(2); return result.value + '|' + trace.join(',');`,
  },
  {
    name: "accessor-backed get trap is looked up for every read",
    body: `const trace = []; const proxy = new Proxy({ value: 1 }, { get get() { trace.push('lookup'); return (target, key) => { trace.push('get'); return target[key]; }; } }); const result = proxy.value + proxy.value; return result + '|' + trace.join(',');`,
  },
])("matches native $name", (testCase) => checkDifferentialCases([testCase]));
