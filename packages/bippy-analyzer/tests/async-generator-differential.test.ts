import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches explicit promise-returning iterator requests and checkpoints, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      const values = Array.from({ length: 3 }, () => getRandom(20));
      const failure = getRandom(5) - 1;
      const deferred = getRandom(2) === 0;
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [];
      const values = [${values.join(",")}];
      let position = 0;
      const iterator = { next() {
        const current = position++;
        trace.push('request:' + current);
        return new Promise((resolve, reject) => {
          const settle = () => { trace.push('settle:' + current); if (current === ${failure}) reject('failure:' + current); else resolve({ value: values[current], done: current >= values.length }); };
          ${deferred ? "queueMicrotask(settle);" : "settle();"}
        });
      } };
      const requestItem = (request) => iterator.next().then((result) => trace.push(request + ':' + result.value + ':' + result.done), (error) => trace.push(request + ':' + error));
      for (let request = 0; request < 4; request++) requestItem(request);
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
    name: "queued next calls produce ordered yields and completion",
    expected: "body|sync|resume|first|second|third",
    actual:
      'branch("first|second|third|sync" | "first|second|sync" | "first|third|sync" | "first|sync" | "second|third|sync" | "second|sync" | "third|sync" | "sync")',
    body: `const trace = []; const iterator = ({ async *items() { trace.push('body'); yield 1; trace.push('resume'); yield 2; return 3; } }).items(); iterator.next().then(() => trace.push('first')); iterator.next().then(() => trace.push('second')); iterator.next().then(() => trace.push('third')); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "return before start never enters a finalizer",
    expected: "sync|9:true",
    actual: 'branch(<string> | "sync")',
    body: `const trace = []; const iterator = ({ async *items() { try { trace.push('body'); yield 1; } finally { trace.push('finally'); } } }).items(); iterator.return(9).then((result) => trace.push(result.value + ':' + result.done)); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "throw before start rejects without entering the body",
    expected: "sync|caught:stop",
    actual: 'branch("accepted|sync" | "sync")',
    body: `const trace = []; const iterator = ({ async *items() { trace.push('body'); yield 1; } }).items(); iterator.throw('stop').then(() => trace.push('accepted'), (error) => trace.push('caught:' + error)); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "next after completed return yields undefined and done",
    expected: "sync|first:7:true|second:undefined:true",
    actual: 'branch(<string> | <string> | <string> | "sync")',
    body: `const trace = []; const iterator = ({ async *items() { return 7; } }).items(); iterator.next().then((result) => trace.push('first:' + result.value + ':' + result.done)); iterator.next().then((result) => trace.push('second:' + result.value + ':' + result.done)); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "return queues behind an unresolved yield",
    expected: "body|sync|settle|next:7:false|finally|return:9:true",
    actual: 'branch(<string> | <string> | <string> | "sync|settle")',
    body: `const trace = []; let settle; const pending = new Promise((resolve) => { settle = resolve; }); const iterator = ({ async *items() { try { trace.push('body'); yield pending; trace.push('resumed'); } finally { trace.push('finally'); } } }).items(); iterator.next().then((result) => trace.push('next:' + result.value + ':' + result.done)); iterator.return(9).then((result) => trace.push('return:' + result.value + ':' + result.done)); queueMicrotask(() => { trace.push('settle'); settle(7); }); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "rejected yielded promise runs a finalizer before rejecting next",
    expected: "sync|finally|caught:stop",
    actual: 'branch("accepted|sync" | "sync")',
    body: `const trace = []; let rejectPending; const pending = new Promise((resolve, reject) => { rejectPending = reject; }); const iterator = ({ async *items() { try { yield pending; } finally { trace.push('finally'); } } }).items(); iterator.next().then(() => trace.push('accepted'), (error) => trace.push('caught:' + error)); queueMicrotask(() => rejectPending('stop')); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "yielding finally splits return completion across requests",
    expected: "sync|next:1:false|return:2:false|last:9:true",
    actual:
      'branch(<string> | <string> | <string> | <string> | <string> | <string> | <string> | "sync")',
    body: `const trace = []; const iterator = ({ async *items() { try { yield 1; } finally { yield 2; } } }).items(); iterator.next().then((result) => trace.push('next:' + result.value + ':' + result.done)); iterator.return(9).then((result) => trace.push('return:' + result.value + ':' + result.done)); iterator.next().then((result) => trace.push('last:' + result.value + ':' + result.done)); trace.push('sync'); return () => trace.join('|');`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase], true));

it("unstarted async generator does not execute its body", () =>
  checkDifferentialCases(
    [
      {
        name: "unstarted async generator does not execute its body",
        body: `const trace = []; ({ async *items() { trace.push('body'); yield 1; } }).items(); trace.push('sync'); return () => trace.join('|');`,
      },
    ],
    true,
  ));
