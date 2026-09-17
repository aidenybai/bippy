import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches native settlement races, adoption and microtask side effects, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 50; index++) {
      const firstValue = getRandom(8);
      const secondValue = getRandom(8);
      const firstRejects = getRandom(2) === 0;
      const secondRejects = getRandom(2) === 0;
      const firstAction = `${firstRejects ? "rejectFirst" : "resolveFirst"}(${firstValue});`;
      const secondAction = `${secondRejects ? "rejectSecond" : "resolveSecond"}(${secondValue});`;
      const actions =
        getRandom(2) === 0 ? [firstAction, secondAction] : [secondAction, firstAction];
      const scheduled = actions.map((action) =>
        getRandom(2) === 0 ? action : `queueMicrotask(() => { ${action} });`,
      );
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
        const trace = [];
        const state = { value: ${getRandom(10)} };
        let resolveFirst, rejectFirst, resolveSecond, rejectSecond;
        const first = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
        const second = new Promise((resolve, reject) => { resolveSecond = resolve; rejectSecond = reject; });
        first.then((value) => { trace.push('A' + value); state.value += value; return second; }, (error) => { trace.push('E' + error); return 5; })
          .then((value) => { trace.push('B' + value); state.value += value; }, (error) => { trace.push('C' + error); })
          .finally(() => { trace.push('F'); });
        second.then((value) => trace.push('S' + value), (error) => trace.push('T' + error));
        Promise.all([first, second]).then((values) => trace.push('all:' + values.join(',')), (error) => trace.push('allError:' + error));
        ${scheduled.join("\n")}
        queueMicrotask(() => { resolveFirst(99); rejectSecond(99); trace.push('Q' + state.value); });
        trace.push('sync');
        return () => trace.join('|') + '#' + state.value;
      `,
      });
    }
    await checkDifferentialCases(cases, true);
  },
);

const thenableActions: Record<string, string> = {
  resolve: "resolve(7);",
  reject: "reject('reason');",
  "resolve then reject": "resolve(7); reject('late'); resolve(8);",
  "throw before resolve": "throw 'early';",
  "throw after resolve": "resolve(7); throw 'late';",
  "adopt a promise": "resolve(Promise.resolve(7));",
};

describe.each(Object.entries(thenableActions))("thenable %s", (name, action) => {
  it("known divergence: preserves getter timing, settlement and callback ordering", () =>
    checkKnownDifferentialCases(
      [
        {
          name,
          body: `
      const trace = [];
      const value = { get then() { trace.push('get'); return (resolve, reject) => { trace.push('call'); ${action} }; } };
      Promise.resolve(value).then((result) => trace.push('ok:' + result), (error) => trace.push('error:' + error));
      trace.push('sync');
      return () => trace.join('|');
    `,
        },
      ],
      true,
    ));
});

it.each([
  {
    name: "non-callable then property",
    body: `const trace = []; const value = { then: 7 }; Promise.resolve(value).then((result) => trace.push(result === value)); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "non-callable fulfillment handler",
    body: `let result = ''; Promise.resolve(7).then('ignored').then((value) => { result = String(value); }); return () => result;`,
  },
  {
    name: "non-callable rejection handler",
    body: `let result = ''; Promise.reject('reason').catch({}).then((value) => { result = 'wrong'; }, (error) => { result = error; }); return () => result;`,
  },
  {
    name: "non-callable finally handler",
    body: `let result = ''; Promise.resolve(7).finally(0).then((value) => { result = String(value); }); return () => result;`,
  },
  {
    name: "self resolution",
    body: `let result = ''; let resolve; const promise = new Promise((settle) => { resolve = settle; }); promise.catch((error) => { result = error.name; }); resolve(promise); return () => result;`,
  },
  {
    name: "chained self resolution",
    body: `let result = ''; let child; child = Promise.resolve().then(() => child); child.catch((error) => { result = error.name; }); return () => result;`,
  },
  {
    name: "Promise.all preserves input order",
    body: `let result = ''; let resolve; const delayed = new Promise((settle) => { resolve = settle; }); Promise.all([delayed, Promise.resolve(2), 3]).then((values) => { result = values.join(','); }); resolve(1); return () => result;`,
  },
  {
    name: "empty Promise.all is already fulfilled",
    body: `const trace = []; Promise.all([]).then(() => trace.push('all')); queueMicrotask(() => trace.push('micro')); return () => trace.join('|');`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase], true));

it("known divergence: a throwing then getter rejects without running fulfillment", () =>
  checkKnownDifferentialCases(
    [
      {
        name: "throwing then getter",
        body: `const trace = []; const value = { get then() { trace.push('get'); throw 'getter'; } }; Promise.resolve(value).then(() => trace.push('wrong'), (error) => trace.push(error)); trace.push('sync'); return () => trace.join('|');`,
      },
    ],
    true,
  ));

it.each([
  { name: "constructor resolution", expression: "new Promise((resolve) => resolve(thenable))" },
  { name: "handler return", expression: "Promise.resolve(0).then(() => thenable)" },
  { name: "await", expression: "(async () => await thenable)()" },
  { name: "Promise.all", expression: "Promise.all([thenable]).then((values) => values[0])" },
  { name: "finally", expression: "Promise.resolve(1).finally(() => thenable)" },
])("known divergence: assimilates thenables through $name", ({ name, expression }) =>
  checkKnownDifferentialCases(
    [
      {
        name,
        body: `const trace = []; const thenable = { then: (resolve) => { trace.push('then'); resolve(7); } }; ${expression}.then((value) => trace.push('ok:' + value), (error) => trace.push('error:' + error)); trace.push('sync'); return () => trace.join('|');`,
      },
    ],
    true,
  ),
);
