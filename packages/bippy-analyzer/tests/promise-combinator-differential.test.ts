import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches four-way Promise.all settlement with duplicate inputs and shared payloads, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      const order = [0, 1, 2, 3];
      for (let position = order.length - 1; position > 0; position--) {
        const other = getRandom(position + 1);
        [order[position], order[other]] = [order[other], order[position]];
      }
      const rejection = getRandom(5) - 1;
      const actions = order.map((position) => {
        const action = `trace.push('settle:${position}'); ${position === rejection ? "rejectors" : "resolvers"}[${position}](${position === rejection ? JSON.stringify(`error:${position}`) : "payload"});`;
        return getRandom(2) === 0 ? action : `queueMicrotask(() => { ${action} });`;
      });
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [];
      const resolvers = [], rejectors = [], promises = [];
      const payload = { value: ${getRandom(20)} };
      const create = (position) => new Promise((resolve, reject) => { resolvers[position] = resolve; rejectors[position] = reject; });
      for (let position = 0; position < 4; position++) promises.push(create(position));
      Promise.all([promises[0], promises[1], promises[2], promises[3], promises[0]]).then((values) => trace.push('all:' + values.length + ':' + (values[0] === values[4]) + ':' + values[0].value), (error) => trace.push('error:' + error));
      ${actions.join("\n")}
      payload.value += ${getRandom(20)};
      trace.push('sync');
      return () => trace.join('|');
    `,
      });
    }
    await checkDifferentialCases(cases, true);
  },
);

it.each([
  {
    name: "race settles with the first fulfilled input",
    expected: "sync|ok:7",
    actual: 'branch(<string> | "undefined|sync" | "sync")',
    body: `const trace = []; Promise.race([Promise.resolve(7), Promise.resolve(9)]).then((value) => trace.push('ok:' + value), (error) => trace.push('error:' + error)); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "race rejects with the first rejection",
    expected: "sync|error:first",
    actual: 'branch(<string> | "undefined|sync" | "sync")',
    body: `const trace = []; Promise.race([Promise.reject('first'), Promise.resolve(9)]).then((value) => trace.push('ok:' + value), (error) => trace.push('error:' + error)); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "empty race stays pending through the checkpoint",
    expected: "sync",
    actual: 'branch("settled|sync" | "undefined|sync" | "sync")',
    body: `const trace = []; Promise.race([]).then(() => trace.push('settled'), () => trace.push('rejected')); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "any ignores rejected inputs until fulfillment",
    expected: "sync|ok:9",
    actual: 'branch(<string> | "undefined|sync" | "sync")',
    body: `const trace = []; Promise.any([Promise.reject('first'), Promise.resolve(9)]).then((value) => trace.push('ok:' + value), (error) => trace.push('error:' + error.name)); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "any AggregateError preserves input rejection order",
    expected: "sync|AggregateError:first,second",
    actual: 'branch("ok|sync" | "undefined|sync" | "sync")',
    body: `const trace = []; let rejectFirst, rejectSecond; const first = new Promise((resolve, reject) => { rejectFirst = reject; }); const second = new Promise((resolve, reject) => { rejectSecond = reject; }); Promise.any([first, second]).then(() => trace.push('ok'), (error) => trace.push(error.name + ':' + error.errors.join(','))); rejectSecond('second'); rejectFirst('first'); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "empty any rejects with an empty AggregateError",
    expected: "sync|AggregateError:0",
    actual: 'branch("ok|sync" | "undefined|sync" | "sync")',
    body: `const trace = []; Promise.any([]).then(() => trace.push('ok'), (error) => trace.push(error.name + ':' + error.errors.length)); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "allSettled preserves input order and both settlement kinds",
    expected: "sync|fulfilled:7|rejected:stop",
    actual: 'branch(<string> | "undefined|sync" | "sync")',
    body: `const trace = []; Promise.allSettled([Promise.resolve(7), Promise.reject('stop')]).then((values) => trace.push(values[0].status + ':' + values[0].value + '|' + values[1].status + ':' + values[1].reason)); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "empty allSettled fulfills with an empty array",
    expected: "sync|length:0",
    actual: 'branch(<string> | "undefined|sync" | "sync")',
    body: `const trace = []; Promise.allSettled([]).then((values) => trace.push('length:' + values.length)); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "all consumes iterable inputs in order",
    expected: "sync|7,9",
    actual: 'branch(<string> | "undefined|sync" | "sync")',
    body: `const trace = []; const inputs = new Set([Promise.resolve(7), Promise.resolve(9)]); Promise.all(inputs).then((values) => trace.push(values.join(',')), (error) => trace.push('error:' + error)); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "all rejects invalid iterable input asynchronously",
    expected: "sync|TypeError",
    actual: 'branch("ok|sync" | "undefined|sync" | "sync")',
    body: `const trace = []; Promise.all(null).then(() => trace.push('ok'), (error) => trace.push(error.name)); trace.push('sync'); return () => trace.join('|');`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase], true));
