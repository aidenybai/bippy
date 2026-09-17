import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)("matches explicit ordinary Promise receivers, seed %i", async (seed) => {
  const getRandom = createSeededRandom(seed);
  const cases: DifferentialCase[] = [];
  for (let index = 0; index < 20; index++) {
    const method = ["resolve", "reject", "all"][index % 3];
    const value = getRandom(30);
    cases.push({
      name: `seed=${seed}/case=${index}`,
      body: `
      const trace = [];
      Promise.${method}.call(Promise, ${method === "all" ? `[${value}, ${value + 1}]` : value}).then(
        (value) => trace.push('fulfilled:' + JSON.stringify(value)),
        (error) => trace.push('rejected:' + error),
      );
      trace.push('sync'); return () => trace.join('|');
    `,
    });
  }
  await checkDifferentialCases(cases, true);
});

interface CapabilityConstructor {
  name: string;
  source: string;
}

const constructors: CapabilityConstructor[] = [
  {
    name: "valid",
    source: `executor((value) => trace.push('fulfilled:' + JSON.stringify(value)), (error) => trace.push('rejected:' + (error instanceof AggregateError ? error.name : error)));`,
  },
  { name: "missing-executor-call", source: "" },
  { name: "noncallable-resolve", source: `executor(7, () => {});` },
  { name: "noncallable-reject", source: `executor(() => {}, 7);` },
  {
    name: "duplicate-executor-call",
    source: `executor(() => {}, () => {}); executor(() => {}, () => {});`,
  },
  { name: "throwing-constructor", source: `throw 'constructor';` },
];

const fulfilledTraces: Record<string, string> = {
  resolve: "constructor|fulfilled:7|after",
  reject: "constructor|rejected:7|after",
  all: "constructor|resolve:7:true|then:7|resolve:9:true|then:9|fulfilled:[14,18]|after",
  race: "constructor|resolve:7:true|then:7|fulfilled:14|resolve:9:true|then:9|fulfilled:18|after",
  any: "constructor|resolve:7:true|then:7|fulfilled:14|resolve:9:true|then:9|fulfilled:18|after",
  allSettled:
    'constructor|resolve:7:true|then:7|resolve:9:true|then:9|fulfilled:[{"status":"fulfilled","value":14},{"status":"fulfilled","value":18}]|after',
};

const cases = Object.keys(fulfilledTraces).flatMap((method) =>
  constructors.map((constructor) => ({
    expected:
      constructor.name === "valid"
        ? fulfilledTraces[method]
        : `constructor|caught:${constructor.name === "throwing-constructor" ? "constructor" : "TypeError"}`,
    actual: '"after"',
    name: `${method}/${constructor.name}`,
    body: `
    const trace = [];
    class Capability {
      constructor(executor) { trace.push('constructor'); ${constructor.source} }
      static resolve(value) {
        trace.push('resolve:' + value + ':' + (this === Capability));
        return { then(fulfilled, rejected) { trace.push('then:' + value); fulfilled(value * 2); } };
      }
    }
    try { Promise.${method}.call(Capability, ${method === "resolve" || method === "reject" ? "7" : "[7, 9]"}); trace.push('after'); }
    catch (error) { trace.push('caught:' + (error instanceof TypeError ? error.name : error)); }
    return trace.join('|');
  `,
  })),
);

it.each(cases)("known divergence: custom capability $name", (testCase) =>
  checkKnownDifferentialWitnesses([testCase]),
);

it.each(Object.keys(fulfilledTraces))(
  "known divergence: nonconstructible receiver validation for %s",
  (method) =>
    checkKnownDifferentialWitnesses([
      {
        expected: "TypeError",
        actual: '"accepted"',
        name: `${method}/nonconstructible`,
        body: `try { Promise.${method}.call(() => {}, ${method === "resolve" || method === "reject" ? "7" : "[]"}); return 'accepted'; } catch (error) { return error.name; }`,
      },
    ]),
);
