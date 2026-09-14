import * as React from "react";
import { jsx } from "react/jsx-runtime";
import {
  _fiberRoots,
  getFiber,
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

interface ActivityProbeProps {
  owner: number;
  label: string;
}
interface ActivityStore {
  value: number;
  listeners: Set<() => void>;
  getSnapshot: () => number;
  subscribe: (listener: () => void) => () => void;
  publish: (value: number) => void;
}
interface ActivityIdentity {
  fiber: Fiber;
  hostFiber: Fiber;
  host: HTMLSpanElement;
  identifier: number;
  hostIdentifier: number;
  token: object;
}
interface ActivityReplayOptions {
  owner: number;
  returnsCleanup: boolean;
  publishesInLayout: boolean;
  hasHiddenMount: boolean;
}

const runActivityStore = async ({
  owner,
  returnsCleanup,
  publishesInLayout,
  hasHiddenMount,
}: ActivityReplayOptions): Promise<string[]> => {
  const otherOwner = 1 - owner;
  const harnesses = [createRenderHarness(), createRenderHarness()];
  const trace: string[] = [];
  const transcript: string[] = [];
  const bodies = new Set<string>();
  const identities = new Map<number, ActivityIdentity>();
  const retired = new Set<number>();
  let shouldPublishInLayout = false;
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const stores: ActivityStore[] = harnesses.map((_, checkedOwner) => {
    const store: ActivityStore = {
      value: 0,
      listeners: new Set(),
      getSnapshot: () => store.value,
      subscribe: (listener) => {
        expect(store.listeners.has(listener)).toBe(false);
        record(`subscribe:${checkedOwner}`);
        store.listeners.add(listener);
        return () => {
          expect(store.listeners.delete(listener)).toBe(true);
          record(`unsubscribe:${checkedOwner}`);
        };
      },
      publish: (value) => {
        record(`publish:${checkedOwner}:${value}:${store.listeners.size}`);
        store.value = value;
        for (const listener of store.listeners) listener();
      },
    };
    return store;
  });
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const Probe = ({ owner: checkedOwner, label }: ActivityProbeProps) => {
    const [token] = React.useState(() => ({}));
    const store = stores[checkedOwner];
    const value = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
    const rendering = getRenderingFiber();
    if (!rendering) throw new Error("Missing Activity rendering fiber");
    const identifier = getFiberId(rendering);
    const hostIdentifier = React.useRef<number | null>(null);
    const getLiveness = (): string =>
      `${getFiberById(identifier) !== null}:${hostIdentifier.current === null ? "absent" : getFiberById(hostIdentifier.current) !== null}`;
    const name = `${checkedOwner}:${label}:${value}`;
    bodies.add(name);
    const ref = React.useCallback(
      (host: HTMLSpanElement | null) => {
        if (!host) {
          record(`ref-null:${checkedOwner}:${getLiveness()}`);
          return;
        }
        const hostFiber = getFiber(host);
        if (!hostFiber) throw new Error("Missing Activity host attachment");
        hostIdentifier.current = getFiberId(getLatestFiber(hostFiber));
        record(`ref-on:${checkedOwner}:${getLiveness()}`);
        if (returnsCleanup)
          return () => {
            record(`ref-cleanup:${checkedOwner}:${getLiveness()}`);
          };
      },
      [checkedOwner],
    );
    React.useInsertionEffect(() => {
      record(`insertion-on:${name}:${getLiveness()}`);
      return () => {
        record(`insertion-off:${name}:${getLiveness()}`);
      };
    }, [label, value]);
    React.useLayoutEffect(() => {
      expect(rendering.memoizedState?.memoizedState === token).toBe(true);
      record(`layout-on:${name}:${getLiveness()}`);
      return () => {
        record(`layout-off:${name}:${getLiveness()}`);
      };
    }, [label, value]);
    React.useEffect(() => {
      record(`passive-on:${name}:${getLiveness()}`);
      return () => {
        record(`passive-off:${name}:${getLiveness()}`);
      };
    }, [label, value]);
    return jsx("span", { ref, "data-owner": checkedOwner, children: name });
  };
  const Subscriber = React.memo(Probe);
  const Wrapper = ({ owner: checkedOwner, label }: ActivityProbeProps) => {
    React.useLayoutEffect(() => {
      record(`wrapper-on:${checkedOwner}`);
      if (checkedOwner === owner && shouldPublishInLayout) {
        shouldPublishInLayout = false;
        stores[checkedOwner].publish(1);
      }
      return () => {
        record(`wrapper-off:${checkedOwner}`);
      };
    }, [checkedOwner]);
    return jsx(Subscriber, { owner: checkedOwner, label });
  };
  const getValue = (fiber: Fiber): number => {
    const value = fiber.memoizedState?.next?.memoizedState;
    if (typeof value !== "number") throw new Error("Missing committed store snapshot");
    return value;
  };
  const getProbe = (checkedOwner: number): Fiber => {
    const fiber = getFiberPreorder(harnesses[checkedOwner].getRoot().current).find(
      (candidate) => candidate.type === Probe,
    );
    if (!fiber) throw new Error("Missing Activity subscriber");
    return fiber;
  };
  using _observer = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      const checkedOwner = harnesses.findIndex(
        (harness) => "containerInfo" in root && root.containerInfo === harness.container,
      );
      if (checkedOwner === -1) return;
      const fiber = getFiberPreorder(root.current).find((candidate) => candidate.type === Probe);
      if (fiber) {
        const host = fiber.child?.stateNode;
        if (!(host instanceof HTMLSpanElement)) throw new Error("Missing committed Activity host");
        record(
          `commit:${checkedOwner}:${fiber.memoizedProps.label}:${getValue(fiber)}:${host.style.display || "visible"}:${stores[checkedOwner].listeners.size}:${getFiberById(getFiberId(fiber)) === fiber}`,
        );
      } else
        record(
          `commit:${checkedOwner}:empty:${stores[checkedOwner].listeners.size}:${_fiberRoots.has(root)}`,
        );
      traverseRenderedFibers(checkedOwner === 0 ? root.current : root, (visited, phase) => {
        if (visited.type === Probe)
          record(
            `phase:${checkedOwner}:${visited.memoizedProps.label}:${getValue(visited)}:${phase}`,
          );
      });
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type !== Probe && fiber.type !== "span") return;
      const isProbe = fiber.type === Probe;
      const checkedOwner = Number(
        isProbe ? fiber.memoizedProps.owner : fiber.memoizedProps["data-owner"],
      );
      const identity = identities.get(checkedOwner);
      if (!identity) throw new Error("Missing Activity deletion identity");
      const identifier = isProbe ? identity.identifier : identity.hostIdentifier;
      record(
        `delete-${isProbe ? "probe" : "host"}:${checkedOwner}:${getFiberById(identifier) === fiber}`,
      );
    },
  });
  const render = (checkedOwner: number, isHidden: boolean, label: string): Promise<void> =>
    harnesses[checkedOwner].render(
      jsx(React.Activity, {
        mode: isHidden ? "hidden" : "visible",
        children: jsx(Wrapper, { owner: checkedOwner, label }),
      }),
    );
  const check = (
    checkedOwner: number,
    label: string,
    value: number,
    isHidden: boolean,
  ): ActivityIdentity => {
    const fiber = getProbe(checkedOwner);
    const hostFiber = fiber.child;
    const host = hostFiber?.stateNode;
    const token = fiber.memoizedState?.memoizedState;
    if (
      !hostFiber ||
      !(host instanceof HTMLSpanElement) ||
      typeof token !== "object" ||
      token === null
    )
      throw new Error("Missing retained Activity state");
    const identifier = getFiberId(fiber);
    const hostIdentifier = getFiberId(hostFiber);
    const previous = identities.get(checkedOwner);
    if (previous) {
      expect(identifier).toBe(previous.identifier);
      expect(hostIdentifier).toBe(previous.hostIdentifier);
      expect(host === previous.host).toBe(true);
      expect(token === previous.token).toBe(true);
      expect(getLatestFiber(previous.fiber) === fiber).toBe(true);
      expect(getLatestFiber(previous.hostFiber) === hostFiber).toBe(true);
    }
    expect(getFiberById(identifier) === fiber).toBe(true);
    expect(getFiberById(hostIdentifier) === hostFiber).toBe(true);
    expect(getLatestFiber(fiber) === fiber).toBe(true);
    expect(getValue(fiber)).toBe(value);
    expect(fiber.memoizedProps.label).toBe(label);
    expect(host.textContent).toBe(`${checkedOwner}:${label}:${value}`);
    expect(host.style.display).toBe(isHidden ? "none" : "");
    expect(host.isConnected).toBe(true);
    expect(stores[checkedOwner].listeners.size).toBe(isHidden ? 0 : 1);
    expect(_fiberRoots.has(harnesses[checkedOwner].getRoot())).toBe(true);
    for (const retiredIdentifier of retired) expect(getFiberById(retiredIdentifier)).toBeNull();
    const identity = previous ?? { fiber, hostFiber, host, identifier, hostIdentifier, token };
    identities.set(checkedOwner, identity);
    return identity;
  };
  const retire = (checkedOwner: number): ActivityIdentity => {
    expect(bodies.size).toBe(0);
    const previous = identities.get(checkedOwner);
    if (!previous) throw new Error("Missing retired Activity identity");
    retired.add(previous.identifier);
    retired.add(previous.hostIdentifier);
    expect(getFiberById(previous.identifier)).toBeNull();
    expect(getFiberById(previous.hostIdentifier)).toBeNull();
    expect(getFiber(previous.host)).toBeNull();
    expect(previous.host.isConnected).toBe(false);
    expect(stores[checkedOwner].listeners.size).toBe(0);
    expect(_fiberRoots.has(harnesses[checkedOwner].getRoot())).toBe(false);
    identities.delete(checkedOwner);
    return previous;
  };
  const refOff = returnsCleanup ? "ref-cleanup" : "ref-null";
  const getMountTrace = (checkedOwner: number, label: string, value: number): string[] => [
    `insertion-on:${checkedOwner}:${label}:${value}:true:absent`,
    `ref-on:${checkedOwner}:true:true`,
    `layout-on:${checkedOwner}:${label}:${value}:true:true`,
    `wrapper-on:${checkedOwner}`,
    `commit:${checkedOwner}:${label}:${value}:visible:0:true`,
    `phase:${checkedOwner}:${label}:${value}:mount`,
    `subscribe:${checkedOwner}`,
    `passive-on:${checkedOwner}:${label}:${value}:true:true`,
  ];
  const getHideTrace = (value: number): string[] => [
    `wrapper-off:${owner}`,
    `layout-off:${owner}:b:${value}:true:true`,
    `${refOff}:${owner}:true:true`,
    `commit:${owner}:b:${value}:none:1:true`,
    `unsubscribe:${owner}`,
    `passive-off:${owner}:b:${value}:true:true`,
    `commit:${owner}:b:${value}:none:0:true`,
  ];
  const getVisibleDeleteTrace = (checkedOwner: number, label: string, value: number): string[] => [
    `wrapper-off:${checkedOwner}`,
    `delete-probe:${checkedOwner}:true`,
    `insertion-off:${checkedOwner}:${label}:${value}:false:true`,
    `layout-off:${checkedOwner}:${label}:${value}:false:true`,
    `delete-host:${checkedOwner}:true`,
    `${refOff}:${checkedOwner}:false:false`,
    `commit:${checkedOwner}:empty:1:false`,
    `unsubscribe:${checkedOwner}`,
    `passive-off:${checkedOwner}:${label}:${value}:false:false`,
  ];
  for (const checkedOwner of [0, 1]) {
    const isHidden = checkedOwner === owner && hasHiddenMount;
    await render(checkedOwner, isHidden, "a");
    expect(trace.splice(0)).toEqual(
      isHidden
        ? [
            `commit:${checkedOwner}:empty:0:true`,
            `insertion-on:${checkedOwner}:a:0:true:absent`,
            `commit:${checkedOwner}:a:0:none:0:true`,
            `phase:${checkedOwner}:a:0:mount`,
          ]
        : getMountTrace(checkedOwner, "a", 0),
    );
    expect(bodies).toEqual(new Set([`${checkedOwner}:a:0`]));
    bodies.clear();
    check(checkedOwner, "a", 0, isHidden);
  }
  if (hasHiddenMount) {
    await render(owner, false, "a");
    expect(trace.splice(0)).toEqual([
      `ref-on:${owner}:true:true`,
      `layout-on:${owner}:a:0:true:true`,
      `wrapper-on:${owner}`,
      `commit:${owner}:a:0:visible:0:true`,
      `subscribe:${owner}`,
      `passive-on:${owner}:a:0:true:true`,
    ]);
    expect(bodies.size).toBe(0);
    check(owner, "a", 0, false);
  }
  await render(owner, false, "b");
  expect(trace.splice(0)).toEqual([
    `insertion-off:${owner}:a:0:true:true`,
    `insertion-on:${owner}:b:0:true:true`,
    `layout-off:${owner}:a:0:true:true`,
    `layout-on:${owner}:b:0:true:true`,
    `commit:${owner}:b:0:visible:1:true`,
    `phase:${owner}:b:0:update`,
    `passive-off:${owner}:a:0:true:true`,
    `passive-on:${owner}:b:0:true:true`,
  ]);
  expect(bodies).toEqual(new Set([`${owner}:b:0`]));
  bodies.clear();
  check(owner, "b", 0, false);
  await render(owner, true, "b");
  expect(trace.splice(0)).toEqual(getHideTrace(0));
  expect(bodies.size).toBe(0);
  check(owner, "b", 0, true);
  check(otherOwner, "a", 0, false);
  const hiddenRoot = harnesses[owner].getRoot().current;
  if (publishesInLayout) shouldPublishInLayout = true;
  else {
    await React.act(async () => stores[owner].publish(1));
    expect(trace.splice(0)).toEqual([`publish:${owner}:1:0`]);
    expect(harnesses[owner].getRoot().current === hiddenRoot).toBe(true);
    expect(bodies.size).toBe(0);
  }
  const controlRoot = harnesses[otherOwner].getRoot().current;
  await render(owner, false, "b");
  expect(trace.splice(0)).toEqual([
    `ref-on:${owner}:true:true`,
    `layout-on:${owner}:b:0:true:true`,
    `wrapper-on:${owner}`,
    ...(publishesInLayout ? [`publish:${owner}:1:0`] : []),
    `commit:${owner}:b:0:visible:0:true`,
    `subscribe:${owner}`,
    `passive-on:${owner}:b:0:true:true`,
    `insertion-off:${owner}:b:0:true:true`,
    `insertion-on:${owner}:b:1:true:true`,
    `layout-off:${owner}:b:0:true:true`,
    `layout-on:${owner}:b:1:true:true`,
    `commit:${owner}:b:1:visible:1:true`,
    `phase:${owner}:b:1:update`,
    `passive-off:${owner}:b:0:true:true`,
    `passive-on:${owner}:b:1:true:true`,
  ]);
  expect(bodies).toEqual(new Set([`${owner}:b:1`]));
  bodies.clear();
  expect(shouldPublishInLayout).toBe(false);
  expect(harnesses[otherOwner].getRoot().current === controlRoot).toBe(true);
  check(owner, "b", 1, false);
  check(otherOwner, "a", 0, false);
  await render(owner, true, "b");
  expect(trace.splice(0)).toEqual(getHideTrace(1));
  expect(bodies.size).toBe(0);
  check(owner, "b", 1, true);
  await harnesses[owner].render(null);
  expect(trace.splice(0)).toEqual([
    `delete-probe:${owner}:true`,
    `insertion-off:${owner}:b:1:false:true`,
    `delete-host:${owner}:true`,
    `commit:${owner}:empty:0:false`,
  ]);
  const previousIdentity = retire(owner);
  check(otherOwner, "a", 0, false);
  await render(owner, false, "b");
  expect(trace.splice(0)).toEqual(getMountTrace(owner, "b", 1));
  expect(bodies).toEqual(new Set([`${owner}:b:1`]));
  bodies.clear();
  const remounted = check(owner, "b", 1, false);
  expect(remounted.identifier).not.toBe(previousIdentity.identifier);
  expect(remounted.hostIdentifier).not.toBe(previousIdentity.hostIdentifier);
  expect(remounted.host === previousIdentity.host).toBe(false);
  expect(remounted.token === previousIdentity.token).toBe(false);
  await harnesses[owner].render(null);
  expect(trace.splice(0)).toEqual(getVisibleDeleteTrace(owner, "b", 1));
  retire(owner);
  check(otherOwner, "a", 0, false);
  await harnesses[otherOwner].render(null);
  expect(trace.splice(0)).toEqual(getVisibleDeleteTrace(otherOwner, "a", 0));
  retire(otherOwner);
  for (const identifier of retired) expect(getFiberById(identifier)).toBeNull();
  return transcript;
};

it.each(
  [0, 1].flatMap((owner) =>
    [false, true].flatMap((returnsCleanup) =>
      [false, true].flatMap((publishesInLayout) =>
        [false, true].map((hasHiddenMount) => ({
          owner,
          returnsCleanup,
          publishesInLayout,
          hasHiddenMount,
        })),
      ),
    ),
  ),
)(
  "replays Activity store reconnection, owner $owner, cleanup ref $returnsCleanup, layout publication $publishesInLayout, hidden mount $hasHiddenMount",
  async (options) => {
    expect(await runActivityStore(options)).toEqual(await runActivityStore(options));
  },
);
