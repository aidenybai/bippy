import {
  getFiberById,
  getFiberId,
  getRDTHook,
  instrument,
  type Fiber,
  type FiberRoot,
  type ReactDevToolsTarget,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { createFiber } from "./fiber-fixture.js";
import { createSeededRandom, fuzzSeeds } from "./seeded-random.js";

interface UnmountRecord {
  fiber: Fiber;
  alternate: Fiber;
  identifiers: number[];
}

it.each(fuzzSeeds)(
  "preserves nested dispatch order and releases both alternate IDs, seed %i",
  (seed) => {
    const getRandom = createSeededRandom(seed);
    for (const doesReporterThrow of [false, true]) {
      const target: ReactDevToolsTarget = {};
      const foreignTarget: ReactDevToolsTarget = {};
      const hook = getRDTHook(undefined, target);
      const trace: string[] = [];
      const snapshots: boolean[][] = [];
      const records: UnmountRecord[] = Array.from({ length: 3 + getRandom(6) }, (_, index) => {
        const fiber = createFiber({ key: String(index) });
        const alternate = createFiber({ key: String(index) });
        const identifiers = [getFiberId(fiber), getFiberId(alternate)];
        fiber.alternate = alternate;
        alternate.alternate = fiber;
        return { fiber, alternate, identifiers };
      });
      const root: FiberRoot = { current: createFiber() };
      hook.onCommitFiberUnmount = (_rendererId, fiber) => {
        trace.push(`previous:${fiber.key}`);
        throw new Error(`previous:${fiber.key}`);
      };
      using _reporter = vi
        .spyOn(console, "error")
        .mockImplementation((message: unknown, error: unknown) => {
          trace.push(`${message}:${error instanceof Error ? error.message : "unexpected"}`);
          hook.onPostCommitFiberRoot(7, root);
          if (doesReporterThrow) throw new Error("reporter failure");
        });
      using _post = instrument({
        target,
        onPostCommitFiberRoot: () => {
          trace.push("reporter:post");
        },
      });
      using _foreign = instrument({
        target: foreignTarget,
        onCommitFiberUnmount: () => {
          trace.push("foreign");
        },
      });
      using _reentrant = instrument({
        target,
        onCommitFiberUnmount: (rendererId, fiber) => {
          const index = records.findIndex(
            (record) => record.fiber === fiber || record.alternate === fiber,
          );
          trace.push(`enter:${rendererId}:${index}`);
          if (index + 1 < records.length) {
            const next = records[index + 1];
            hook.onCommitFiberUnmount(rendererId, index % 2 === 0 ? next.alternate : next.fiber);
          } else {
            unsubscribeRemoved();
            unsubscribeRemoved();
          }
          snapshots.push(
            records.flatMap((record) =>
              record.identifiers.map((identifier) => getFiberById(identifier) !== null),
            ),
          );
          trace.push(`exit:${index}`);
        },
      });
      using _throwing = instrument({
        target,
        onCommitFiberUnmount: (_rendererId, fiber) => {
          trace.push(`throw:${fiber.key}`);
          throw new Error(`listener:${fiber.key}`);
        },
      });
      using unsubscribeRemoved = instrument({
        target,
        onCommitFiberUnmount: () => {
          trace.push("removed");
        },
      });
      using unsubscribeObserver = instrument({
        target,
        onCommitFiberUnmount: (rendererId, fiber) => {
          trace.push(`observe:${rendererId}:${fiber.key}`);
        },
      });

      hook.onCommitFiberUnmount(7, records[0].fiber);
      const expectedTrace: string[] = [];
      const expectedSnapshots: boolean[][] = [];
      for (let index = 0; index < records.length; index++) {
        expectedTrace.push(
          `previous:${index}`,
          `Bippy instrumentation encountered an error::previous:${index}`,
          "reporter:post",
          `enter:7:${index}`,
        );
      }
      for (let index = records.length - 1; index >= 0; index--) {
        expectedSnapshots.push(
          records.flatMap((_, recordIndex) => [recordIndex <= index, recordIndex <= index]),
        );
        expectedTrace.push(
          `exit:${index}`,
          `throw:${index}`,
          `Bippy instrumentation encountered an error::listener:${index}`,
          "reporter:post",
          `observe:7:${index}`,
        );
      }
      const context = JSON.stringify({ seed, doesReporterThrow, depth: records.length });
      expect(trace, context).toEqual(expectedTrace);
      expect(snapshots, context).toEqual(expectedSnapshots);
      for (const record of records) {
        for (const identifier of record.identifiers)
          expect(getFiberById(identifier), context).toBeNull();
        expect(record.fiber.alternate).toBe(record.alternate);
        expect(record.alternate.alternate).toBe(record.fiber);
        const nextIdentifier = getFiberId(record.fiber);
        expect(record.identifiers).not.toContain(nextIdentifier);
        expect(getFiberId(record.alternate)).toBe(nextIdentifier);
      }
      _reentrant();
      _throwing();
      unsubscribeObserver();
      _post();
      trace.length = 0;
      for (const record of records) {
        const identifier = getFiberId(record.fiber);
        hook.onCommitFiberUnmount(7, record.alternate);
        expect(getFiberById(identifier)).toBeNull();
      }
      expect(trace).toEqual(
        records.flatMap((record) => [
          `previous:${record.fiber.key}`,
          `Bippy instrumentation encountered an error::previous:${record.fiber.key}`,
        ]),
      );
    }
  },
);
