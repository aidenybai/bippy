import * as React from "react";
import {
  getFiberById,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  instrument,
  traverseRenderedFibers,
  type Fiber,
} from "bippy";
import { expect, it } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";
import { createSeededRandom, fuzzSeeds } from "./seeded-random.js";

interface RootProps {
  owner: number;
}

interface PrimaryProps extends RootProps {
  value: number;
}

interface TransitionModel {
  value: number;
  suspendedValue: number;
  pending: ReturnType<typeof Promise.withResolvers<void>>;
  update: React.Dispatch<React.SetStateAction<number>>;
}

interface TransitionAttempt extends PrimaryProps {
  fiber: Fiber;
}

it.each(fuzzSeeds)(
  "isolates committed identity during interleaved completed and abandoned transitions, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const harnesses = [createRenderHarness(), createRenderHarness()];
    const models: TransitionModel[] = harnesses.map(() => ({
      value: 0,
      suspendedValue: -1,
      pending: Promise.withResolvers<void>(),
      update: () => {
        throw new Error("Root has not mounted");
      },
    }));
    const renderer = [...getRDTHook().renderers.values()].find(
      (candidate) => candidate.rendererPackageName === "react-dom",
    );
    if (!renderer?.getCurrentFiber) throw new Error("Missing React render oracle");
    const getRenderingFiber = renderer.getCurrentFiber;
    const attempts: TransitionAttempt[] = [];
    const effects: string[] = [];
    const phases: string[] = [];
    const stableRenders: number[] = [];
    const Stable = React.memo(({ owner }: RootProps) => {
      stableRenders.push(owner);
      return <i>stable</i>;
    });
    const Primary = ({ owner, value }: PrimaryProps) => {
      const fiber = getRenderingFiber();
      if (!fiber) throw new Error("Missing rendering fiber");
      attempts.push({ owner, value, fiber });
      React.useLayoutEffect(() => {
        effects.push(`on:${owner}:${value}`);
        return () => {
          effects.push(`off:${owner}:${value}`);
        };
      }, [owner, value]);
      if (models[owner].suspendedValue === value) throw models[owner].pending.promise;
      return <span>{value}</span>;
    };
    const App = ({ owner }: RootProps) => {
      const [value, update] = React.useState(0);
      models[owner].update = update;
      return (
        <>
          <Stable owner={owner} />
          <React.Suspense fallback={<b>loading</b>}>
            <Primary key="shared-key" owner={owner} value={value} />
          </React.Suspense>
        </>
      );
    };
    using _unsubscribe = instrument({
      onCommitFiberRoot: (_rendererId, root) => {
        traverseRenderedFibers(root, (fiber, phase) => {
          if (fiber.type === Primary)
            phases.push(`${phase}:${fiber.memoizedProps.owner}:${fiber.memoizedProps.value}`);
        });
      },
    });
    for (const [owner, harness] of harnesses.entries()) await harness.render(<App owner={owner} />);
    const getPrimary = (owner: number): Fiber => {
      const fiber = getFiberPreorder(harnesses[owner].getRoot().current).find(
        (candidate) => candidate.type === Primary,
      );
      if (!fiber) throw new Error(`Missing primary for root ${owner}`);
      return fiber;
    };
    const firstFibers = models.map((_, owner) => getPrimary(owner));
    const identifiers = firstFibers.map(getFiberId);
    expect(new Set(identifiers).size).toBe(2);
    expect(effects.splice(0)).toEqual(["on:0:0", "on:1:0"]);
    expect(phases.splice(0)).toEqual(["mount:0:0", "mount:1:0"]);
    expect(stableRenders.splice(0)).toEqual([0, 1]);

    for (let step = 0; step < 16; step++) {
      const owner = getRandom(2);
      const otherOwner = 1 - owner;
      const model = models[owner];
      const otherModel = models[otherOwner];
      const previousValue = model.value;
      const previousOtherValue = otherModel.value;
      const previousFiber = getPrimary(owner);
      const previousRoot = harnesses[owner].getRoot().current;
      model.suspendedValue = model.value + 1;
      model.pending = Promise.withResolvers<void>();
      attempts.length = 0;
      await React.act(async () => {
        React.startTransition(() => model.update(model.suspendedValue));
      });
      const attempt = attempts.find(
        (candidate) => candidate.owner === owner && candidate.value === model.suspendedValue,
      );
      const context = JSON.stringify({ seed, step, owner });
      if (!attempt) throw new Error(`Transition never attempted: ${context}`);
      expect(attempt.fiber).not.toBe(previousFiber);
      expect(attempt.fiber.alternate).toBe(previousFiber);
      expect(getFiberId(attempt.fiber), context).toBe(identifiers[owner]);
      expect(getLatestFiber(attempt.fiber)).toBe(previousFiber);
      expect(harnesses[owner].getRoot().current).toBe(previousRoot);
      expect(effects, context).toEqual([]);
      expect(phases, context).toEqual([]);

      otherModel.value += 2;
      await React.act(async () => otherModel.update(otherModel.value));
      expect(getLatestFiber(attempt.fiber)).toBe(previousFiber);
      expect(getFiberById(identifiers[owner])).toBe(previousFiber);
      expect(harnesses[owner].getRoot().current).toBe(previousRoot);
      expect(harnesses[owner].container.textContent).toBe(`stable${previousValue}`);
      expect(effects.splice(0), context).toEqual([
        `off:${otherOwner}:${previousOtherValue}`,
        `on:${otherOwner}:${otherModel.value}`,
      ]);
      expect(phases.splice(0), context).toEqual([`update:${otherOwner}:${otherModel.value}`]);

      const isAbandoned = step % 2 === 0;
      model.value = model.suspendedValue + (isAbandoned ? 1 : 0);
      if (isAbandoned) await React.act(async () => model.update(model.value));
      await React.act(async () => {
        model.suspendedValue = -1;
        model.pending.resolve();
        await model.pending.promise;
      });
      expect(effects.splice(0), context).toEqual([
        `off:${owner}:${previousValue}`,
        `on:${owner}:${model.value}`,
      ]);
      expect(phases.splice(0), context).toEqual([`update:${owner}:${model.value}`]);
      expect(stableRenders, context).toEqual([]);
      for (const checkedOwner of [0, 1]) {
        const current = getPrimary(checkedOwner);
        expect(getLatestFiber(firstFibers[checkedOwner])).toBe(current);
        expect(getFiberById(identifiers[checkedOwner])).toBe(current);
        expect(getFiberId(current)).toBe(identifiers[checkedOwner]);
        expect(harnesses[checkedOwner].container.textContent).toBe(
          `stable${models[checkedOwner].value}`,
        );
        const stable = getFiberPreorder(harnesses[checkedOwner].getRoot().current).find(
          (fiber) => fiber.elementType === Stable,
        );
        if (!stable?.child || !stable.alternate)
          throw new Error(`Missing memo bailout: ${context}`);
        expect(stable.child).toBe(stable.alternate.child);
        expect(getLatestFiber(stable.child)).toBe(stable.child);
      }
      expect(getLatestFiber(attempt.fiber)).toBe(getPrimary(owner));
    }
    for (const [owner, harness] of harnesses.entries()) {
      await harness.render(null);
      expect(getFiberById(identifiers[owner])).toBeNull();
      expect(effects.splice(0)).toEqual([`off:${owner}:${models[owner].value}`]);
    }
  },
);
