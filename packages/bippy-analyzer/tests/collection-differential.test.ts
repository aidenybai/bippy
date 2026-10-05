import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const collectionKinds = ["Map", "Set"];

const getInitialCollection = (kind: string): string =>
  kind === "Map" ? "new Map([[1, 10], [2, 20], [3, 30]])" : "new Set([1, 2, 3])";

const getWrite = (kind: string, key: string, value: string): string =>
  kind === "Map" ? `collection.set(${key}, ${value})` : `collection.add(${key})`;

describe.each(collectionKinds)("%s differential semantics", (kind) => {
  it.each(differentialSeeds)(
    "preserves key identity and order under mutation sequences, seed %i",
    async (seed) => {
      const getRandom = createSeededRandom(seed);
      const cases: DifferentialCase[] = [];
      for (let index = 0; index < 40; index++) {
        const operations: string[] = [];
        for (let step = 0; step < 16; step++) {
          const key = `keys[${getRandom(9)}]`;
          const choices = [
            `trace.push(${getWrite(kind, key, String(getRandom(8)))} === collection);`,
            `trace.push(collection.delete(${key}));`,
            `trace.push(collection.has(${key}));`,
            kind === "Map" ? `trace.push(collection.get(${key}));` : `trace.push(collection.size);`,
            "trace.push(collection.clear());",
          ];
          operations.push(choices[getRandom(choices.length)], "trace.push(snapshot());");
        }
        cases.push({
          name: `${kind}/seed=${seed}/case=${index}`,
          body: `
          const shared = {}; const twin = {};
          const keys = [0, NaN, '0', undefined, null, shared, twin, Symbol('same'), Symbol('same')];
          const encode = (key) => key === shared ? 'shared' : key === twin ? 'twin' : key === keys[7] ? 'symbol1' : key === keys[8] ? 'symbol2' : typeof key + ':' + String(key);
          const collection = new ${kind}();
          const snapshot = () => [...collection.entries()].map((entry) => encode(entry[0]) + '=' + ${kind === "Map" ? "entry[1]" : "encode(entry[1])"}).join(',');
          const trace = [];
          ${operations.join("\n")}
          return trace.join('|');
        `,
        });
      }
      await checkDifferentialCases(cases);
    },
  );

  it.each(["append", "delete", "clear", "throw", ...(kind === "Map" ? ["overwrite"] : [])])(
    "known divergence: observes %s during forEach",
    (mutation) => {
      const operation =
        mutation === "append"
          ? getWrite(kind, "4", "40")
          : mutation === "delete"
            ? "collection.delete(2)"
            : mutation === "overwrite"
              ? getWrite(kind, "2", "99")
              : mutation === "clear"
                ? "collection.clear()"
                : "(() => { throw 'callback'; })()";
      return checkKnownDifferentialCases([
        {
          name: `${kind}/forEach/${mutation}`,
          body: `
        const collection = ${getInitialCollection(kind)};
        const visited = [];
        try {
          collection.forEach((value, key, receiver) => {
            visited.push(key + ':' + value + ':' + (receiver === collection));
            if (key === 1) { ${operation}; }
          });
        } catch (error) { visited.push('caught:' + error); }
        return visited.join('|') + '#' + collection.size;
      `,
        },
      ]);
    },
  );

  it("visits each existing key once when the current entry is rewritten", () =>
    checkDifferentialCases([
      {
        name: `${kind}/forEach/current entry`,
        body: `const collection = ${getInitialCollection(kind)}; const trace = []; collection.forEach((value, key, receiver) => { trace.push(key + ':' + value + ':' + (receiver === collection)); ${getWrite(kind, "key", "value + 1")}; }); return trace.join('|') + '#' + [...collection.values()].join(',');`,
      },
    ]));

  it("known divergence: keeps an iterator live across deletion, insertion, and exhaustion", () =>
    checkKnownDifferentialCases([
      {
        name: `${kind}/live iterator`,
        body: `
      const collection = ${getInitialCollection(kind)};
      const iterator = collection.keys();
      const trace = [iterator.next().value];
      collection.delete(2);
      ${getWrite(kind, "4", "40")};
      trace.push(iterator.next().value, iterator.next().value, iterator.next().done);
      ${getWrite(kind, "5", "50")};
      trace.push(iterator.next().done);
      return trace.join('|');
    `,
      },
    ]));

  it("known divergence: normalizes negative zero when exposing stored keys", () =>
    checkKnownDifferentialCases([
      {
        name: `${kind}/negative zero`,
        body: `const collection = new ${kind}(); ${getWrite(kind, "-0", "7")}; return Object.is(collection.keys().next().value, -0);`,
      },
    ]));
});

const createWeakKeyCase = (kind: string, key: string): DifferentialCase => ({
  name: `${kind}/${key}`,
  body: `const collection = new ${kind}(); const key = ${key}; try { collection.${kind === "WeakMap" ? "set(key, 1)" : "add(key)"}; return collection.has(key); } catch (error) { return error.name; }`,
});

describe.each(["WeakMap", "WeakSet"])("%s key validity", (kind) => {
  it.each(["0", "null", "undefined", "'key'", "Symbol.for('registered')"])(
    "known divergence: rejects %s as a weak key",
    (key) => checkKnownDifferentialCases([createWeakKeyCase(kind, key)]),
  );
  it.each(["{}", "() => null", "Symbol('unregistered')"])("accepts %s as a weak key", (key) =>
    checkDifferentialCases([createWeakKeyCase(kind, key)]),
  );
});
