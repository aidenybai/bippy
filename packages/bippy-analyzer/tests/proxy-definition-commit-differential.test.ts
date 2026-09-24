import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { checkDifferentialCases } from "./helpers/differential-evaluator.js";

interface TrapResult {
  name: string;
  source: string;
  isTruthy: boolean;
}

interface DefinitionFailure {
  mode: string;
  index: number;
}

const names = ["alpha", "beta", "gamma"];
const failures: DefinitionFailure[] = [
  { mode: "forward", index: -1 },
  ...[
    "claim",
    "reject",
    "mutate-reject",
    "throw",
    "mutate-throw",
    "lookup-throw",
    "noncallable",
    "absent",
    "null",
  ].flatMap((mode) => [0, 1, 2].map((index) => ({ mode, index }))),
];
const cases = failures.flatMap((failure) =>
  [false, true].flatMap((hasSourceGetter) =>
    [false, true].map((isStaged) => {
      const expectedTrace = hasSourceGetter ? names.map((name) => `convert:${name}`) : [];
      const expectedValues = ["_", "_", "_"];
      let outcome = "after";
      for (let index = 0; index < names.length; index++) {
        const name = names[index];
        const mode = index === failure.index ? failure.mode : "forward";
        expectedTrace.push(`lookup:${name}`);
        if (mode === "lookup-throw" || mode === "noncallable") {
          outcome = mode === "lookup-throw" ? "caught:token" : "caught:TypeError";
          break;
        }
        if (mode !== "absent" && mode !== "null")
          expectedTrace.push(`trap:${name}:true:true:true:true:${index + 7}`);
        if (mode === "reject" || mode === "throw") {
          outcome = mode === "reject" ? "caught:TypeError" : "caught:token";
          break;
        }
        if (mode !== "claim")
          expectedValues[index] = String(index + 7 + (mode.startsWith("mutate-") ? 100 : 0));
        if (mode.startsWith("mutate-")) {
          outcome = mode === "mutate-reject" ? "caught:TypeError" : "caught:token";
          break;
        }
      }
      expectedTrace.push(outcome);
      const sourceEntries = names.map(
        (name, index) =>
          `${name}: { ${hasSourceGetter ? `get value() { trace.push('convert:${name}'); return ${index + 7}; }` : `value: ${index + 7}`}, enumerable: true, configurable: true, writable: true, extra: 'ignored' }`,
      );
      return {
        name: `${failure.mode}/index=${failure.index}/getter=${hasSourceGetter}/staged=${isStaged}`,
        expected: expectedTrace.join("|") + "#" + expectedValues.join(","),
        body: `const trace = []; const token = {}; const backing = {}; const names = ['alpha', 'beta', 'gamma']; const descriptors = { ${sourceEntries.join(",")} }; let lookups = 0; const operation = { define(innerTarget, key, converted) { trace.push('trap:' + key + ':' + (this === handler) + ':' + (innerTarget === backing) + ':' + (converted !== descriptors[key]) + ':' + !Object.hasOwn(converted, 'extra') + ':' + converted.value); const mode = key === names[${failure.index}] ? ${JSON.stringify(failure.mode)} : 'forward'; if (mode === 'claim') return true; if (mode === 'reject') return false; if (mode === 'throw') throw token; if (mode === 'mutate-reject' || mode === 'mutate-throw') converted.value += 100; Object.defineProperty(innerTarget, key, converted); if (mode === 'mutate-reject') return false; if (mode === 'mutate-throw') throw token; return true; } }; const handler = { get defineProperty() { const index = lookups; lookups += 1; trace.push('lookup:' + names[index]); const mode = index === ${failure.index} ? ${JSON.stringify(failure.mode)} : 'forward'; if (mode === 'lookup-throw') throw token; if (mode === 'noncallable') return 7; if (mode === 'absent') return undefined; if (mode === 'null') return null; return operation.define; } }; const proxy = new Proxy(backing, handler); try { ${isStaged ? `const normalized = []; for (const key of names) { const original = descriptors[key]; const enumerable = original.enumerable; const configurable = original.configurable; const value = original.value; const writable = original.writable; normalized.push([key, { enumerable, configurable, value, writable }]); } for (const pair of normalized) { const method = handler.defineProperty; if (method === undefined || method === null) { Object.defineProperty(backing, pair[0], pair[1]); } else { if (typeof method !== 'function') throw new TypeError(); const accepted = method.call(handler, backing, pair[0], pair[1]); if (!accepted) throw new TypeError(); } }` : "Object.defineProperties(proxy, descriptors);"} trace.push('after'); } catch (error) { trace.push(error === token ? 'caught:token' : 'caught:' + error.name); } return trace.join('|') + '#' + names.map((name) => Object.hasOwn(backing, name) ? String(backing[name]) : '_').join(',');`,
      };
    }),
  ),
);

it.each(cases)("preserves proxy definition completion: $name", async ({ name, body, expected }) => {
  expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
    expected,
  );
  await checkDifferentialCases([{ name, body }]);
});

const trapResults: TrapResult[] = [
  { name: "true", source: "true", isTruthy: true },
  { name: "false", source: "false", isTruthy: false },
  { name: "number", source: "7", isTruthy: true },
  { name: "zero", source: "0", isTruthy: false },
  {
    name: "object-with-hook",
    source: "({ [Symbol.toPrimitive]: () => { trace.push('coerce'); throw token; } })",
    isTruthy: true,
  },
  { name: "null", source: "null", isTruthy: false },
  { name: "undefined", source: "undefined", isTruthy: false },
  { name: "empty-string", source: "''", isTruthy: false },
  { name: "string", source: "'accepted'", isTruthy: true },
];
const resultCases = trapResults.flatMap((result) =>
  [false, true].flatMap((shouldWrite) =>
    [false, true].map((isStaged) => ({
      name: `${result.name}/write=${shouldWrite}/staged=${isStaged}`,
      expected: `call:true:true:true:entry:7|${result.isTruthy ? "after" : "TypeError"}#${shouldWrite ? "7" : "_"}`,
      body: `const trace = []; const token = {}; const backing = {}; const descriptor = { value: 7, writable: true, configurable: true, enumerable: true }; const handler = { defineProperty(innerTarget, key, converted) { trace.push('call:' + (this === handler) + ':' + (innerTarget === backing) + ':' + (converted !== descriptor) + ':' + key + ':' + converted.value); ${shouldWrite ? "Object.defineProperty(innerTarget, key, converted);" : ""} return ${result.source}; } }; const proxy = new Proxy(backing, handler); try { ${isStaged ? "const converted = { value: descriptor.value, writable: descriptor.writable, configurable: descriptor.configurable, enumerable: descriptor.enumerable }; const accepted = handler.defineProperty.call(handler, backing, 'entry', converted); if (!accepted) throw new TypeError();" : "Object.defineProperty(proxy, 'entry', descriptor);"} trace.push('after'); } catch (error) { trace.push(error.name); } return trace.join('|') + '#' + (Object.hasOwn(backing, 'entry') ? String(backing.entry) : '_');`,
    })),
  ),
);

it.each(resultCases)(
  "preserves proxy definition result: $name",
  async ({ name, body, expected }) => {
    expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
      expected,
    );
    await checkDifferentialCases([{ name, body }]);
  },
);
