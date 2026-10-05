import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches native overlapping async workers with rejection and finalizers, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 40; index++) {
      const actions = Array.from(
        { length: 6 },
        (_, actionIndex) =>
          `workers[${Math.floor(actionIndex / 2)}].${actionIndex % 2 === 0 ? "first" : "second"}.${getRandom(3) === 0 ? "reject" : "resolve"}(${getRandom(20)});`,
      );
      for (let position = actions.length - 1; position > 0; position--) {
        const selected = getRandom(position + 1);
        [actions[position], actions[selected]] = [actions[selected], actions[position]];
      }
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
        const trace = [];
        const shared = { value: 0 };
        const createDeferred = () => {
          let resolve, reject;
          const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
          promise.catch(() => {});
          return { promise, resolve, reject };
        };
        const workers = [0, 1, 2].map((name) => ({ name, first: createDeferred(), second: createDeferred() }));
        const run = async (name, first, second) => {
          trace.push(name + ':start');
          let result;
          try {
            const firstValue = await first;
            trace.push(name + ':first:' + firstValue);
            const secondValue = await second;
            trace.push(name + ':second:' + secondValue);
            shared.value += firstValue + secondValue;
            result = firstValue + secondValue;
          } catch (error) {
            trace.push(name + ':caught:' + error);
            result = 'caught';
          } finally {
            trace.push(name + ':cleanup');
          }
          trace.push(name + ':cleaned');
          return result;
        };
        workers.forEach((worker) => run(worker.name, worker.first.promise, worker.second.promise).then((value) => trace.push(worker.name + ':done:' + value), (error) => trace.push(worker.name + ':failed:' + error)));
        ${actions.map((action) => (getRandom(2) === 0 ? action : `queueMicrotask(() => { ${action} });`)).join("\n")}
        trace.push('sync');
        return () => trace.join('|') + '#' + shared.value;
      `,
      });
    }
    await checkDifferentialCases(cases, true);
  },
);

describe.each([
  { name: "concise", source: "await Promise.resolve(7)" },
  { name: "block", source: "{ return await Promise.resolve(7); }" },
])("async arrow $name body", ({ name, source }) => {
  it("matches native suspension before fulfillment", () =>
    checkDifferentialCases(
      [
        {
          name,
          body: `const trace = []; const run = async () => ${source}; run().then((value) => trace.push('ok:' + value), (error) => trace.push('error:' + error)); trace.push('sync'); queueMicrotask(() => trace.push('queued')); return () => trace.join('|');`,
        },
      ],
      true,
    ));
});

const completions = [
  { name: "return primitive", source: "return 7;" },
  { name: "return pending", source: "return pending;" },
  { name: "return await pending", source: "return await pending;" },
  { name: "throw primitive", source: "throw 'body';" },
];
const finalizers = [
  { name: "normal", source: "trace.push('cleanup');" },
  {
    name: "await",
    source: "trace.push('cleanup'); await Promise.resolve(); trace.push('cleaned');",
  },
  { name: "return", source: "trace.push('cleanup'); return 9;" },
  { name: "throw", source: "trace.push('cleanup'); throw 'cleanup';" },
  {
    name: "await then return",
    source: "trace.push('cleanup'); await Promise.resolve(); trace.push('cleaned'); return 9;",
  },
  {
    name: "await then throw",
    source:
      "trace.push('cleanup'); await Promise.resolve(); trace.push('cleaned'); throw 'cleanup';",
  },
];

describe.each(
  completions.flatMap((completion) =>
    finalizers.map((finalizer) => ({
      completion,
      finalizer,
      name: `${completion.name}/${finalizer.name}`,
    })),
  ),
)("async completion: $name", ({ name, completion, finalizer }) => {
  it("matches native completion precedence and ordering", () => {
    const testCase = {
      name,
      body: `
        const trace = [];
        let settle;
        const pending = new Promise((resolve) => { settle = resolve; });
        const run = async () => { try { trace.push('body'); ${completion.source} } finally { ${finalizer.source} } };
        run().then((value) => trace.push('ok:' + value), (error) => trace.push('error:' + error));
        trace.push('sync');
        queueMicrotask(() => { trace.push('settle'); settle(5); });
        return () => trace.join('|');
      `,
    };
    return checkDifferentialCases([testCase], true);
  });
});

it.each(["resolve", "reject"])("awaits pending finalizers that %s", (settlement) =>
  checkDifferentialCases(
    [
      {
        name: `pending finally/${settlement}`,
        body: `
    const trace = [];
    let settle;
    const pending = new Promise((resolve, reject) => { settle = ${settlement}; });
    const run = async () => { try { return 7; } finally { trace.push('cleanup'); await pending; trace.push('cleaned'); } };
    run().then((value) => trace.push('ok:' + value), (error) => trace.push('error:' + error));
    trace.push('sync');
    queueMicrotask(() => { trace.push('settle'); settle('reason'); });
    return () => trace.join('|');
  `,
      },
    ],
    true,
  ),
);

it.each([
  {
    name: "synchronous try",
    prefix: "try {} finally {}",
  },
  {
    name: "suspended try",
    prefix: "try { await Promise.resolve(); } finally {}",
  },
])("awaits following a $name retain suspension semantics", ({ name, prefix }) =>
  checkDifferentialCases(
    [
      {
        name,
        body: `const trace = []; const run = async () => { ${prefix} trace.push('before'); await Promise.resolve(); trace.push('after'); }; run().then(() => trace.push('done'), (error) => trace.push('error:' + error)); trace.push('sync'); queueMicrotask(() => trace.push('queued')); return () => trace.join('|');`,
      },
    ],
    true,
  ),
);
