import * as React from "react";
import {
  getFiberById,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  instrument,
  type Fiber,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";

interface LifecycleProbeProps {
  owner: number;
  name: string;
  value: number;
}

const runCommitLifecycle = async (deletedOwner: number): Promise<string[]> => {
  const harnesses = [createRenderHarness(), createRenderHarness()];
  const otherOwner = 1 - deletedOwner;
  const hook = getRDTHook();
  const renderer = [...hook.renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const trace: string[] = [];
  const transcript: string[] = [];
  const identifiers = new Map<string, number>();
  const record = (value: string): void => {
    trace.push(value);
    transcript.push(value);
  };
  const Probe = ({ owner, name, value }: LifecycleProbeProps) => {
    const rendering = getRenderingFiber();
    if (!rendering) throw new Error("Missing rendering fiber");
    let identifier = -1;
    React.useLayoutEffect(() => {
      identifier = getFiberId(rendering);
      identifiers.set(`${owner}:${name}`, identifier);
      record(`layout-on:${owner}:${name}:${value}:${getLatestFiber(rendering) === rendering}`);
      return () => {
        record(`layout-off:${owner}:${name}:${value}:${getFiberById(identifier) === null}`);
      };
    }, [owner, name, value]);
    React.useEffect(() => {
      record(`passive-on:${owner}:${name}:${value}`);
      return () => {
        record(`passive-off:${owner}:${name}:${value}:${getFiberById(identifier) === null}`);
      };
    }, [owner, name, value]);
    return (
      <span>
        {owner}:{name}:{value}
      </span>
    );
  };
  const render = (owner: number, value: number, names = ["a", "b"]) =>
    harnesses[owner].render(
      <>
        {names.map((name) => (
          <Probe key={name} owner={owner} name={name} value={value} />
        ))}
      </>,
    );
  const getProbes = (owner: number): Fiber[] =>
    getFiberPreorder(harnesses[owner].getRoot().current).filter((fiber) => fiber.type === Probe);
  for (const owner of [0, 1]) {
    await render(owner, 0);
    expect(trace.splice(0)).toEqual([
      `layout-on:${owner}:a:0:true`,
      `layout-on:${owner}:b:0:true`,
      `passive-on:${owner}:a:0`,
      `passive-on:${owner}:b:0`,
    ]);
  }
  const mountedIdentifiers = new Map(identifiers);
  await render(deletedOwner, 1);
  expect([...identifiers]).toEqual([...mountedIdentifiers]);
  expect(trace.splice(0)).toEqual([
    `layout-off:${deletedOwner}:a:0:false`,
    `layout-off:${deletedOwner}:b:0:false`,
    `layout-on:${deletedOwner}:a:1:true`,
    `layout-on:${deletedOwner}:b:1:true`,
    `passive-off:${deletedOwner}:a:0:false`,
    `passive-off:${deletedOwner}:b:0:false`,
    `passive-on:${deletedOwner}:a:1`,
    `passive-on:${deletedOwner}:b:1`,
  ]);
  for (const fiber of getProbes(deletedOwner)) {
    expect(fiber.alternate !== null).toBe(true);
    if (!fiber.alternate) throw new Error("Expected updated alternate");
    expect(getFiberId(fiber.alternate)).toBe(getFiberId(fiber));
  }
  const otherProbes = getProbes(otherOwner);
  const otherIdentifiers = otherProbes.map(getFiberId);
  const previousUnmount = hook.onCommitFiberUnmount;
  const failure = new Error("previous live unmount failed");
  let didRewire = false;
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      record(`report:${message}:${error === failure}`);
      throw new Error("reporter failed");
    });
  hook.onCommitFiberUnmount = (rendererId, fiber) => {
    previousUnmount.call(hook, rendererId, fiber);
    if (fiber.type !== Probe) return;
    record(`previous:${fiber.memoizedProps.owner}:${fiber.memoizedProps.name}`);
    if (!didRewire) {
      didRewire = true;
      const captured = hook.onCommitFiberUnmount;
      hook.onCommitFiberUnmount = (innerRendererId, innerFiber) => {
        if (innerFiber.type === Probe)
          record(`wrapper:${innerFiber.memoizedProps.owner}:${innerFiber.memoizedProps.name}`);
        captured.call(hook, innerRendererId, innerFiber);
      };
      using _rewire = instrument({});
      record("rewire");
    }
    throw failure;
  };
  try {
    using _observer = instrument({
      onCommitFiberUnmount: (_rendererId, fiber) => {
        if (fiber.type !== Probe) return;
        const key = `${fiber.memoizedProps.owner}:${fiber.memoizedProps.name}`;
        const identifier = identifiers.get(key);
        record(`listener:${key}:${identifier !== undefined && getFiberById(identifier) === fiber}`);
      },
    });
    await render(deletedOwner, 1, ["b"]);
    expect(trace.splice(0)).toEqual([
      `previous:${deletedOwner}:a`,
      "rewire",
      "report:Bippy instrumentation encountered an error::true",
      `listener:${deletedOwner}:a:true`,
      `layout-off:${deletedOwner}:a:1:true`,
      `passive-off:${deletedOwner}:a:1:true`,
    ]);
    const deletedIdentifier = identifiers.get(`${deletedOwner}:a`);
    if (deletedIdentifier === undefined) throw new Error("Missing deleted ID");
    expect(getFiberById(deletedIdentifier)).toBeNull();
    expect(harnesses[deletedOwner].container.textContent).toBe(`${deletedOwner}:b:1`);
    for (const [index, fiber] of otherProbes.entries())
      expect(getFiberById(otherIdentifiers[index]) === fiber).toBe(true);
    await harnesses[deletedOwner].render(null);
    expect(trace.splice(0)).toEqual([
      `wrapper:${deletedOwner}:b`,
      `previous:${deletedOwner}:b`,
      "report:Bippy instrumentation encountered an error::true",
      `listener:${deletedOwner}:b:true`,
      `layout-off:${deletedOwner}:b:1:true`,
      `passive-off:${deletedOwner}:b:1:true`,
    ]);
    await harnesses[otherOwner].render(null);
    expect(trace.splice(0)).toEqual([
      ...["a", "b"].flatMap((name) => [
        `wrapper:${otherOwner}:${name}`,
        `previous:${otherOwner}:${name}`,
        "report:Bippy instrumentation encountered an error::true",
        `listener:${otherOwner}:${name}:true`,
        `layout-off:${otherOwner}:${name}:0:true`,
      ]),
      `passive-off:${otherOwner}:a:0:true`,
      `passive-off:${otherOwner}:b:0:true`,
    ]);
    for (const identifier of identifiers.values()) expect(getFiberById(identifier)).toBeNull();
    expect(harnesses.map((harness) => harness.container.childElementCount)).toEqual([0, 0]);
  } finally {
    hook.onCommitFiberUnmount = previousUnmount;
    using _restore = instrument({});
  }
  return transcript;
};

it.each([0, 1])(
  "replays exact ID liveness across live commit phases and dispatcher replacement, deleted root %i",
  async (deletedOwner) => {
    expect(await runCommitLifecycle(deletedOwner)).toEqual(await runCommitLifecycle(deletedOwner));
  },
);
