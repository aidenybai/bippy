import { expect, it } from "vite-plus/test";
import {
  checkSymbolicCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches native guarded reaction bodies and independent field writes, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 12; index++) {
      const initial = getRandom(8);
      const firstValue = 10 + getRandom(8);
      const secondValue = 20 + getRandom(8);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
        const state = { left: ${initial}, right: ${initial} };
        let settle;
        const pending = new Promise((resolve) => { settle = resolve; });
        pending.then(() => { if (first) state.left = ${firstValue}; });
        pending.then(() => { if (second) state.right = ${secondValue}; });
        queueMicrotask(() => settle());
        return () => state.left + ':' + state.right;
      `,
      });
    }
    await checkSymbolicCases(cases, true);
  },
);

it.each([
  {
    name: "conditional registration on an already settled promise preserves both outcomes",
    body: `let result = 'initial'; if (first) Promise.resolve().then(() => { result = 'updated'; }); return () => result;`,
  },
  {
    name: "a conditionally unresolved promise remains pending only on that path",
    body: `let result = 'pending'; let settle; const pending = new Promise((resolve) => { settle = resolve; }); pending.then((value) => { result = value; }); if (first) settle(second ? 'left' : 'right'); return () => result;`,
  },
  {
    name: "first settlement wins independently in fulfilled and rejected forks",
    body: `let result = 'pending'; const pending = new Promise((resolve, reject) => { if (first) resolve('first'); else reject('second'); if (second) resolve('late'); }); pending.then((value) => { result = 'ok:' + value; }, (error) => { result = 'error:' + error; }); return () => result;`,
  },
  {
    name: "conditional reaction bodies preserve the input outcome predicate",
    body: `let result = 'pending'; Promise.resolve(first ? 'left' : 'right').then((value) => { if (second) result = value; }); return () => result;`,
  },
  {
    name: "a queued write through a forked alias reaches only its selected allocation",
    body: `const original = { value: 0 }; let selected = original; if (first) selected = { value: 1 }; const captured = selected; queueMicrotask(() => { if (second) captured.value = 2; }); return () => original.value + ':' + selected.value;`,
  },
  {
    name: "a guarded rejection is recovered before a subsequent reaction reads shared state",
    body: `const state = { value: 'initial' }; const pending = first ? Promise.resolve('ready') : Promise.reject('failed'); pending.catch((error) => { state.value = error; }).then(() => { if (second) state.value = 'last'; }); return () => state.value;`,
  },
])("$name", (testCase) => checkSymbolicCases([testCase], true));

it.each([
  {
    name: "one conditionally registered reaction on a pending promise",
    body: `let result = 'initial'; let settle; const pending = new Promise((resolve) => { settle = resolve; }); if (first) pending.then(() => { result = 'updated'; }); queueMicrotask(() => settle()); return () => result;`,
    message: "state leaves truthy(#1) undecided",
  },
  {
    name: "conditional last writer",
    body: `const state = { value: 0 }; let settle; const pending = new Promise((resolve) => { settle = resolve; }); if (first) pending.then(() => { state.value = 1; }); if (second) pending.then(() => { state.value = 2; }); queueMicrotask(() => settle()); return () => String(state.value);`,
    message:
      "state leaves truthy(#1) | and(not(truthy(#1)), truthy(#2)) | and(not(truthy(#1)), not(truthy(#2))) undecided",
  },
  {
    name: "conditionally registered independent writers",
    body: `const state = { left: 0, right: 0 }; let settle; const pending = new Promise((resolve) => { settle = resolve; }); if (first) pending.then(() => { state.left = 1; }); if (second) pending.then(() => { state.right = 2; }); queueMicrotask(() => settle()); return () => state.left + ':' + state.right;`,
    message:
      "state leaves and(truthy(#1), truthy(#2)) | and(truthy(#1), not(truthy(#2))) | and(not(truthy(#1)), truthy(#2)) | and(not(truthy(#1)), not(truthy(#2))) undecided",
  },
])("known divergence: state enumeration crashes on $name", async ({ name, body, message }) => {
  await expect(checkSymbolicCases([{ name, body }], true)).rejects.toMatchObject({
    name: "Error",
    message,
  });
});
