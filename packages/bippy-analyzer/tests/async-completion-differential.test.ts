import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
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
  it(
    name === "concise"
      ? "known divergence: awaiting a fulfilled promise still requires suspension"
      : "matches native suspension before fulfillment",
    () => {
      const testCase = {
        name,
        body: `const trace = []; const run = async () => ${source}; run().then((value) => trace.push('ok:' + value), (error) => trace.push('error:' + error)); trace.push('sync'); queueMicrotask(() => trace.push('queued')); return () => trace.join('|');`,
      };
      if (name === "block") return checkDifferentialCases([testCase], true);
      return checkKnownDifferentialWitnesses(
        [{ ...testCase, expected: "sync|queued|ok:7", actual: JSON.stringify("sync|ok:7|queued") }],
        true,
      );
    },
  );
});

const completions = [
  { name: "return primitive", source: "return 7;", outcome: "ok:7" },
  { name: "return pending", source: "return pending;", outcome: "ok:5" },
  { name: "return await pending", source: "return await pending;", outcome: "ok:5" },
  { name: "throw primitive", source: "throw 'body';", outcome: "error:body" },
];
const finalizers = [
  { name: "normal", source: "trace.push('cleanup');" },
  {
    name: "await",
    source: "trace.push('cleanup'); await Promise.resolve(); trace.push('cleaned');",
  },
  { name: "return", source: "trace.push('cleanup'); return 9;", outcome: "ok:9" },
  { name: "throw", source: "trace.push('cleanup'); throw 'cleanup';", outcome: "error:cleanup" },
  {
    name: "await then return",
    source: "trace.push('cleanup'); await Promise.resolve(); trace.push('cleaned'); return 9;",
    outcome: "ok:9",
  },
  {
    name: "await then throw",
    source:
      "trace.push('cleanup'); await Promise.resolve(); trace.push('cleaned'); throw 'cleanup';",
    outcome: "error:cleanup",
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
  const isKnownDivergence =
    finalizer.name.startsWith("await") && completion.name !== "return await pending";
  it(
    isKnownDivergence
      ? "known divergence: cleanup skips its suspension boundary"
      : "matches native completion precedence and ordering",
    () => {
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
      if (!isKnownDivergence) return checkDifferentialCases([testCase], true);
      const outcome = finalizer.outcome ?? completion.outcome;
      const ending =
        completion.name === "return pending" && finalizer.name === "await"
          ? `settle|${outcome}`
          : `${outcome}|settle`;
      return checkKnownDifferentialWitnesses(
        [
          {
            ...testCase,
            expected: `body|cleanup|sync|cleaned|settle|${outcome}`,
            actual: JSON.stringify(`body|cleanup|cleaned|sync|${ending}`),
          },
        ],
        true,
      );
    },
  );
});

it.each(["resolve", "reject"])(
  "known divergence: pending finalizers that %s are not awaited",
  (settlement) =>
    checkKnownDifferentialWitnesses(
      [
        {
          name: `pending finally/${settlement}`,
          expected:
            settlement === "resolve"
              ? "cleanup|sync|settle|cleaned|ok:7"
              : "cleanup|sync|settle|error:reason",
          actual: JSON.stringify("cleanup|cleaned|sync|ok:7|settle"),
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
    expected: "before|sync|after|queued|done",
    actual: "before|after|sync|done|queued",
  },
  {
    name: "suspended try",
    prefix: "try { await Promise.resolve(); } finally {}",
    expected: "sync|before|queued|after|done",
    actual: "sync|before|after|queued|done",
  },
])(
  "known divergence: awaits following a $name retain suspension semantics",
  ({ name, prefix, expected, actual }) =>
    checkKnownDifferentialWitnesses(
      [
        {
          name,
          expected,
          actual: JSON.stringify(actual),
          body: `const trace = []; const run = async () => { ${prefix} trace.push('before'); await Promise.resolve(); trace.push('after'); }; run().then(() => trace.push('done'), (error) => trace.push('error:' + error)); trace.push('sync'); queueMicrotask(() => trace.push('queued')); return () => trace.join('|');`,
        },
      ],
      true,
    ),
);
