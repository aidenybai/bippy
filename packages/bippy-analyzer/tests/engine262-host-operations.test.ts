import { expect, it } from "vite-plus/test";
import { HostOperations } from "../src/engine/host-operations.js";
import { runProbe } from "../experiments/engine262/probe.js";
import { resolve } from "node:path";

it("keeps a host checkpoint open until registered work finishes", async () => {
  const operations = new HostOperations();
  const deferred = Promise.withResolvers<number>();
  const result = operations.track(deferred.promise);
  let isSettled = false;
  const checkpoint = operations.settle().then(() => {
    isSettled = true;
  });
  await new Promise<void>((resolveCheckpoint) => setImmediate(resolveCheckpoint));
  expect(isSettled).toBe(false);
  deferred.resolve(7);
  await checkpoint;
  expect(await result).toBe(7);
  expect(isSettled).toBe(true);
});

it("includes work registered by an earlier host completion", async () => {
  const operations = new HostOperations();
  const first = Promise.withResolvers<number>();
  const second = Promise.withResolvers<number>();
  const observed: number[] = [];
  const result = operations.track(first.promise).then((value) => {
    observed.push(value);
    return operations.track(second.promise).then((next) => {
      observed.push(next);
    });
  });
  let isSettled = false;
  const checkpoint = operations.settle().then(() => {
    isSettled = true;
  });
  first.resolve(1);
  await new Promise<void>((resolveCheckpoint) => setImmediate(resolveCheckpoint));
  expect(observed).toEqual([1]);
  expect(isSettled).toBe(false);
  second.resolve(2);
  await checkpoint;
  await result;
  expect(observed).toEqual([1, 2]);
});

it("preserves a host rejection for the application", async () => {
  const operations = new HostOperations();
  const failure = new Error("host failure");
  const result = operations.track(Promise.reject(failure));
  const assertion = expect(result).rejects.toBe(failure);
  await operations.settle();
  await assertion;
});

it("batches autosave crypto completion under the declared host checkpoint policy", async () => {
  const filePath = resolve(import.meta.dirname, "components/autosave-indicator.tsx");
  const native = await runProbe({ backend: "native", filePath });
  const engine = await runProbe({ backend: "engine262", filePath });
  expect(native.errors).toEqual([]);
  expect(engine.errors).toEqual([]);
  expect(engine.commits).toEqual(native.commits);
  expect(engine.commits).toHaveLength(4);
  expect(JSON.stringify(engine.commits.at(-1))).toContain("just now");
});
