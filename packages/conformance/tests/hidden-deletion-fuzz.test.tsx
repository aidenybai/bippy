import * as React from "react";
import { getFiberById, getFiberId, getLatestFiber, instrument, type Fiber } from "bippy";
import { expect, it } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";
import { createSeededRandom, fuzzSeeds } from "./seeded-random.js";

interface HiddenGroup {
  itemKey: string;
  isHidden: boolean;
  hasPrimary: boolean;
}

interface HiddenProbeProps {
  name: string;
}

interface HiddenGateProps {
  isHidden: boolean;
  children: React.ReactNode;
}

interface HiddenIdentity {
  fiber: Fiber;
  identifier: number;
  host: HTMLElement;
}

const getGroupNames = (group: HiddenGroup): string[] => [
  ...(group.hasPrimary ? [`${group.itemKey}:primary`] : []),
  ...(group.isHidden ? [`${group.itemKey}:fallback`] : []),
];

const runHiddenDeletionScenario = async (seed: number): Promise<string[]> => {
  const getRandom = createSeededRandom(seed);
  const schedule = Array.from({ length: 100 }, (_, step) => ({
    operation: step < 8 ? step : 1 + getRandom(7),
    selection: getRandom(0x100000000),
    insertion: getRandom(0x100000000),
  }));
  const transcript: string[] = [];
  const record = (trace: string[], entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const harness = createRenderHarness();
  const pending = new Promise<void>(() => {});
  const effects: string[] = [];
  const unmounts: string[] = [];
  const retired = new Set<number>();
  const allKeys = ["", "__proto__", "🧪", "0", "constructor"];
  let requested = allKeys.slice(0, 3).map((itemKey) => ({ itemKey, isHidden: false }));
  let committed: HiddenGroup[] = [];
  let identities = new Map<string, HiddenIdentity>();
  let isOuterHidden = false;
  let wasOuterHidden = false;
  let activeNames: string[] = [];
  const exercised = { deferredDeletion: 0, hiddenDeletion: 0, hiddenMount: 0, reveal: 0 };
  const Probe = ({ name }: HiddenProbeProps) => {
    React.useLayoutEffect(() => {
      record(effects, `layout-on:${name}`);
      return () => {
        record(effects, `layout-off:${name}`);
      };
    }, [name]);
    React.useEffect(() => {
      record(effects, `passive-on:${name}`);
      return () => {
        record(effects, `passive-off:${name}`);
      };
    }, [name]);
    return <span data-probe={name}>{name}</span>;
  };
  const Gate = ({ isHidden, children }: HiddenGateProps) => {
    if (isHidden) throw pending;
    return children;
  };
  using _unsubscribe = instrument({
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type === Probe) record(unmounts, String(fiber.memoizedProps.name));
    },
  });

  for (const [step, { operation, selection, insertion }] of schedule.entries()) {
    const selected = selection % Math.max(1, requested.length);
    if (operation === 1) requested = requested.map((group) => ({ ...group, isHidden: true }));
    if (operation === 2) isOuterHidden = true;
    if (operation === 3 && requested.length) {
      if (isOuterHidden) exercised.deferredDeletion++;
      requested.splice(selected, 1);
    }
    if (operation === 4) requested.reverse();
    if (operation === 5) {
      const available = allKeys.filter(
        (itemKey) => !requested.some((group) => group.itemKey === itemKey),
      );
      if (available.length)
        requested.splice(insertion % (requested.length + 1), 0, {
          itemKey: available[selection % available.length],
          isHidden: true,
        });
    }
    if (operation === 6) isOuterHidden = false;
    if (operation === 7) requested = requested.map((group) => ({ ...group, isHidden: false }));
    const nextCommitted: HiddenGroup[] = isOuterHidden
      ? committed
      : requested.map((group) => ({
          ...group,
          hasPrimary:
            !group.isHidden ||
            committed.some((previous) => previous.itemKey === group.itemKey && previous.hasPrimary),
        }));
    const names = nextCommitted.flatMap(getGroupNames);
    if (isOuterHidden) names.push("outer-fallback");
    const nextActiveNames = isOuterHidden
      ? ["outer-fallback"]
      : nextCommitted.map((group) => `${group.itemKey}:${group.isHidden ? "fallback" : "primary"}`);
    const deletedNames = [
      ...(wasOuterHidden && !isOuterHidden ? ["outer-fallback"] : []),
      ...committed
        .filter((group) => !nextCommitted.some((next) => next.itemKey === group.itemKey))
        .flatMap(getGroupNames),
      ...nextCommitted.flatMap((group) => {
        const previous = committed.find((innerGroup) => innerGroup.itemKey === group.itemKey);
        return previous ? getGroupNames(previous).filter((name) => !names.includes(name)) : [];
      }),
    ];
    if (wasOuterHidden && !isOuterHidden) exercised.reveal++;
    for (const name of deletedNames) if (!activeNames.includes(name)) exercised.hiddenDeletion++;
    for (const group of nextCommitted) if (!group.hasPrimary) exercised.hiddenMount++;
    const removedActive = deletedNames.filter((name) => activeNames.includes(name));
    const disappearing = activeNames.filter(
      (name) => !nextActiveNames.includes(name) && !deletedNames.includes(name),
    );
    const appearing = nextActiveNames.filter((name) => !activeNames.includes(name));
    const mountedNames = names.filter((name) => !identities.has(name));
    const context = JSON.stringify({
      seed,
      step,
      operation,
      isOuterHidden,
      requested,
      committed,
      nextCommitted,
    });
    await harness.render(
      <React.Suspense fallback={<Probe name="outer-fallback" />}>
        <Gate isHidden={isOuterHidden}>
          <section>
            {requested.map((group) => (
              <React.Suspense
                key={group.itemKey}
                fallback={<Probe name={`${group.itemKey}:fallback`} />}
              >
                <Gate isHidden={group.isHidden}>
                  <Probe name={`${group.itemKey}:primary`} />
                </Gate>
              </React.Suspense>
            ))}
          </section>
        </Gate>
      </React.Suspense>,
    );
    expect(effects.splice(0), context).toEqual([
      ...[...removedActive, ...disappearing].map((name) => `layout-off:${name}`),
      ...appearing.map((name) => `layout-on:${name}`),
      ...deletedNames.map((name) => `passive-off:${name}`),
      ...mountedNames.map((name) => `passive-on:${name}`),
    ]);
    expect(unmounts.splice(0), context).toEqual(deletedNames);
    const fibers = getFiberPreorder(harness.getRoot().current).filter(
      (fiber) => fiber.type === Probe,
    );
    expect(
      fibers.map((fiber) => fiber.memoizedProps.name),
      context,
    ).toEqual(names);
    const nextIdentities = new Map<string, HiddenIdentity>();
    for (const fiber of fibers) {
      const name = String(fiber.memoizedProps.name);
      const identifier = getFiberId(fiber);
      const host = fiber.child?.stateNode;
      if (!(host instanceof HTMLElement)) throw new Error(`Missing host: ${context}`);
      const previous = identities.get(name);
      if (previous) {
        expect(identifier, context).toBe(previous.identifier);
        expect(host === previous.host, context).toBe(true);
        expect(getLatestFiber(previous.fiber) === fiber, context).toBe(true);
      }
      expect(retired.has(identifier), context).toBe(false);
      expect(getFiberById(identifier) === fiber, context).toBe(true);
      if (fiber.alternate) expect(getFiberId(fiber.alternate), context).toBe(identifier);
      nextIdentities.set(name, { fiber: previous?.fiber ?? fiber, identifier, host });
    }
    for (const name of deletedNames) {
      const previous = identities.get(name);
      if (!previous) throw new Error(`Missing deleted identity: ${context}`);
      retired.add(previous.identifier);
      expect(previous.host.isConnected, context).toBe(false);
    }
    for (const identifier of retired) expect(getFiberById(identifier), context).toBeNull();
    expect(
      [...harness.container.querySelectorAll<HTMLElement>("[data-probe]")]
        .filter((host) => {
          let ancestor: HTMLElement | null = host;
          while (ancestor && ancestor !== harness.container) {
            if (ancestor.style.display === "none") return false;
            ancestor = ancestor.parentElement;
          }
          return true;
        })
        .map((host) => host.dataset.probe),
      context,
    ).toEqual(nextActiveNames);
    committed = nextCommitted;
    activeNames = nextActiveNames;
    wasOuterHidden = isOuterHidden;
    identities = nextIdentities;
  }
  for (const [operation, count] of Object.entries(exercised))
    expect(count, `seed ${seed}: ${operation}`).toBeGreaterThan(0);
  await harness.render(null);
  expect(unmounts.splice(0)).toEqual([...identities.keys()]);
  expect(effects.splice(0)).toEqual([
    ...activeNames.map((name) => `layout-off:${name}`),
    ...[...identities.keys()].map((name) => `passive-off:${name}`),
  ]);
  for (const { identifier } of identities.values()) expect(getFiberById(identifier)).toBeNull();
  expect(harness.container.childElementCount).toBe(0);
  return transcript;
};

it.each(fuzzSeeds)(
  "replays identical deferred-deletion traces under nested hidden boundaries, seed %i",
  async (seed) => {
    const first = await runHiddenDeletionScenario(seed);
    const second = await runHiddenDeletionScenario(seed);
    expect(second, `replay seed ${seed}`).toEqual(first);
  },
);
