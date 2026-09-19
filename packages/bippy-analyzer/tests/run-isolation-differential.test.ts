import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { createStaticRenderer } from "../src/index.js";
import { UNDEFINED_VALUE, primitiveValue } from "../src/evaluate/values.js";
import { createSeededRandom, differentialSeeds } from "./helpers/differential-evaluator.js";

interface MutationAction {
  operation: string;
  value: number;
}

const stateSource = `
  let calls = 0;
  const state = { values: [1], self: null };
  state.self = state;
  let captured = state.values;
  const cache = new Map();
  const read = () => calls + ':' + state.values.join(',') + ':' + captured.join(',') + ':' + (captured === state.values) + ':' + (state.self === state) + ':' + [...cache.entries()].map((entry) => entry.join('=')).join(',');
  const mutate = (operation, value) => {
    calls++;
    switch (operation) {
      case 'push': state.values.push(value); break;
      case 'pop': state.values.pop(); break;
      case 'replace': state.values = [value]; break;
      case 'capture': captured = state.values; break;
      case 'write-captured': captured.push(value); break;
      case 'set': cache.set(value, calls); break;
      case 'delete': cache.delete(value); break;
      case 'throw': state.values.push(value); throw 'stop';
    }
  };
`;
const runSource = `const run = (operation, value) => {
  let outcome = 'ok';
  try { mutate(operation, value); } catch (error) { outcome = 'caught:' + error; }
  return outcome + '|' + read();
};`;

it.each(differentialSeeds)(
  "preserves intra-run mutations but resets cached modules between derived renders, seed %i",
  async (seed) => {
    const directory = mkdtempSync(join(tmpdir(), "bippy-run-isolation-"));
    try {
      const entryPath = join(directory, "stateful.ts");
      writeFileSync(entryPath, stateSource + "export " + runSource);
      const renderer = await createStaticRenderer({ rootDirectory: directory });
      const derived = renderer.derive({});
      expect(derived.loadModule(entryPath) === renderer.loadModule(entryPath)).toBe(true);
      const getRandom = createSeededRandom(seed);
      const operations = [
        "push",
        "pop",
        "replace",
        "capture",
        "write-captured",
        "set",
        "delete",
        "throw",
      ];
      for (let round = 0; round < 8; round++) {
        const actions: MutationAction[] = Array.from({ length: 40 }, (_, index) => ({
          operation: operations[index < operations.length ? index : getRandom(operations.length)],
          value: getRandom(6),
        }));
        const expected: unknown = runInNewContext(
          `"use strict"; ${stateSource} ${runSource} ${JSON.stringify(actions)}.map((action) => run(action.operation, action.value));`,
          {},
          { timeout: 1000 },
        );
        const currentRenderer = round % 2 === 0 ? renderer : derived;
        const actual: unknown[] = [];
        await currentRenderer.renderWith((interpreter) => {
          const module = currentRenderer.loadModule(entryPath);
          if (!module) throw new Error("Missing stateful module");
          const context = interpreter.createModuleContext(module);
          for (const action of actions) {
            const exported = interpreter.evaluateModuleExport(module, "run");
            const result = interpreter.callValue(
              exported,
              [primitiveValue(action.operation), primitiveValue(action.value)],
              context,
              null,
            );
            expect(result.kind).toBe("primitive");
            if (result.kind === "primitive") actual.push(result.value);
          }
          return UNDEFINED_VALUE;
        });
        expect(actual, JSON.stringify({ seed, round, actions })).toEqual(expected);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
