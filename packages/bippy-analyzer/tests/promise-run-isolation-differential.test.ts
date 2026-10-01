import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { createStaticRenderer } from "../src/index.js";
import { UNDEFINED_VALUE, primitiveValue } from "../src/evaluate/values.js";
import type { StaticValue } from "../src/types.js";
import { differentialSeeds } from "./helpers/differential-evaluator.js";

const moduleSource = `
  const entries = [];
  let resolve;
  const pending = new Promise((settle) => { resolve = settle; });
  const observe = () => pending.then((value) => entries.push(value));
  const settle = (value) => resolve(value);
  const read = () => entries.join(',');
`;

it.each(differentialSeeds)(
  "does not leak settled promises or abandoned microtasks between renders, seed %i",
  async (seed) => {
    const directory = mkdtempSync(join(tmpdir(), "bippy-promise-isolation-"));
    try {
      const entryPath = join(directory, "pending.ts");
      writeFileSync(entryPath, moduleSource + "export { observe, settle, read };");
      const renderer = await createStaticRenderer({ rootDirectory: directory });
      const derived = renderer.derive({});
      expect(derived.loadModule(entryPath) === renderer.loadModule(entryPath)).toBe(true);
      for (let round = 0; round < 6; round++) {
        const value = (seed % 100) + round;
        const shouldAbort = round % 2 === 0;
        const failure = new Error(`abandoned ${seed}/${round}`);
        const expected: unknown = await runInNewContext(
          `"use strict"; ${moduleSource}
        (async () => {
          observe();
          const snapshots = [read()];
          settle(${value}); await Promise.resolve(); snapshots.push(read());
          observe(); await Promise.resolve(); snapshots.push(read());
          settle(${value + 1}); await Promise.resolve(); snapshots.push(read());
          return snapshots;
        })();`,
          {},
          { timeout: 1000 },
        );
        const actual: unknown[] = [];
        const currentRenderer = shouldAbort ? renderer : derived;
        const render = () =>
          currentRenderer.renderWith((interpreter) => {
            const module = currentRenderer.loadModule(entryPath);
            if (!module) throw new Error("Missing promise module");
            const context = interpreter.createModuleContext(module);
            const call = (name: string, args: StaticValue[] = []) =>
              interpreter.callValue(
                interpreter.evaluateModuleExport(module, name),
                args,
                context,
                null,
              );
            const capture = () => {
              const result = call("read");
              expect(result.kind).toBe("primitive");
              if (result.kind === "primitive") actual.push(result.value);
            };
            call("observe");
            capture();
            expect(actual).toEqual([""]);
            call("settle", [primitiveValue(value)]);
            if (shouldAbort) throw failure;
            interpreter.timers.drainMicrotasks();
            capture();
            call("observe");
            interpreter.timers.drainMicrotasks();
            capture();
            call("settle", [primitiveValue(value + 1)]);
            interpreter.timers.drainMicrotasks();
            capture();
            return UNDEFINED_VALUE;
          });
        if (shouldAbort) await expect(render()).rejects.toBe(failure);
        else {
          await render();
          expect(actual, `seed=${seed}/round=${round}`).toEqual(expected);
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
