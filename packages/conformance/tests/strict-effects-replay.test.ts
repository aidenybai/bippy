import * as React from "react";
import { jsx } from "react/jsx-runtime";
import { createPortal } from "react-dom";
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

interface StrictProbeProps {
  name: string;
  generation: number;
}
interface StrictAppProps {
  rows: StrictProbeProps[];
}
interface StrictIdentity {
  fiber: Fiber;
  hostFiber: Fiber;
  host: HTMLSpanElement;
  identifier: number;
  hostIdentifier: number;
  token: object;
}
interface StrictReplayOptions {
  isRootStrict: boolean;
  returnsCleanup: boolean;
  isPassiveUpdate: boolean;
}

const runStrictEffects = async ({
  isRootStrict,
  returnsCleanup,
  isPassiveUpdate,
}: StrictReplayOptions): Promise<string[]> => {
  const harness = createRenderHarness();
  const control = createRenderHarness();
  const target = document.createElement("aside");
  document.body.appendChild(target);
  const initial: StrictProbeProps = { name: "a", generation: 0 };
  const inserted: StrictProbeProps = { name: "b", generation: 0 };
  const replacement: StrictProbeProps = { name: "a", generation: 1 };
  const schedule = [[initial], [initial, inserted], [inserted, initial], [inserted, replacement]];
  const trace: string[] = [];
  const transcript: string[] = [];
  const bodies = new Set<string>();
  const counts = new Map<string, number>();
  const identities = new Map<string, StrictIdentity>();
  const retired = new Set<number>();
  let scheduledKey: string | null = "a:0";
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const getKey = ({ name, generation }: StrictProbeProps): string => `${name}:${generation}`;
  const getCount = (fiber: Fiber): number => {
    const count = fiber.memoizedState?.memoizedState;
    if (typeof count !== "number") throw new Error("Missing probe state");
    return count;
  };
  const Probe = ({ name, generation }: StrictProbeProps) => {
    const fiber = getRenderingFiber();
    if (!fiber) throw new Error("Missing strict rendering fiber");
    const identifier = getFiberId(fiber);
    const [count, update] = React.useState(0);
    const [token] = React.useState(() => ({}));
    const hostIdentifier = React.useRef<number | null>(null);
    const hasScheduled = React.useRef(false);
    const key = `${name}:${generation}`;
    const label = `${key}:${count}`;
    bodies.add(label);
    const getLiveness = (): string =>
      `${getFiberById(identifier) !== null}:${hostIdentifier.current === null ? "absent" : getFiberById(hostIdentifier.current) !== null}`;
    const scheduleUpdate = (): void => {
      if (scheduledKey !== key || hasScheduled.current) return;
      hasScheduled.current = true;
      record(`schedule:${label}`);
      update(1);
    };
    const ref = React.useCallback(
      (host: HTMLSpanElement | null) => {
        if (!host) {
          record(`ref-null:${key}:${getLiveness()}`);
          return;
        }
        const hostFiber = getFiber(host);
        if (!hostFiber) throw new Error("Missing attached host fiber");
        hostIdentifier.current = getFiberId(getLatestFiber(hostFiber));
        record(`ref-on:${key}:${getLiveness()}`);
        if (returnsCleanup)
          return () => {
            record(`ref-cleanup:${key}:${getLiveness()}`);
          };
      },
      [name, generation],
    );
    React.useInsertionEffect(() => {
      record(`insertion-on:${label}:${getLiveness()}`);
      return () => {
        record(`insertion-off:${label}:${getLiveness()}`);
      };
    }, [count]);
    React.useLayoutEffect(() => {
      record(`layout-on:${label}:${getLiveness()}`);
      expect(getLatestFiber(fiber) === fiber).toBe(true);
      expect(fiber.memoizedState?.next?.memoizedState === token).toBe(true);
      return () => {
        record(`layout-off:${label}:${getLiveness()}`);
        if (!isPassiveUpdate) scheduleUpdate();
      };
    }, [count]);
    React.useEffect(() => {
      record(`passive-on:${label}:${getLiveness()}`);
      return () => {
        record(`passive-off:${label}:${getLiveness()}`);
        if (isPassiveUpdate) scheduleUpdate();
      };
    }, [count]);
    return createPortal(
      jsx("span", { ref, "data-probe": key, children: label }),
      target,
      "shared-portal-key",
    );
  };
  const Row = React.memo(Probe);
  const App = ({ rows }: StrictAppProps) => {
    React.useEffect(() => {
      record(`app-passive:${rows.map(getKey).join(",")}`);
    });
    const children = rows.map((row) =>
      jsx(Row, { name: row.name, generation: row.generation }, getKey(row)),
    );
    return isRootStrict ? children : jsx(React.StrictMode, { children });
  };
  const getRows = (root: Fiber): Fiber[] =>
    getFiberPreorder(root).filter((fiber) => fiber.type === Probe);
  const getLabels = (root: Fiber): string =>
    getRows(root)
      .map(
        (fiber) =>
          `${fiber.memoizedProps.name}:${fiber.memoizedProps.generation}:${getCount(fiber)}`,
      )
      .join(",");
  using _observer = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      if (!("containerInfo" in root) || root.containerInfo !== harness.container) return;
      record(`commit:${getLabels(root.current)}`);
      traverseRenderedFibers(isRootStrict ? root.current : root, (fiber, phase) => {
        if (fiber.type === Probe)
          record(
            `phase:${fiber.memoizedProps.name}:${fiber.memoizedProps.generation}:${getCount(fiber)}:${phase}`,
          );
      });
    },
    onPostCommitFiberRoot: (_rendererId, root) => {
      if ("containerInfo" in root && root.containerInfo === harness.container)
        record(`post:${getLabels(root.current)}`);
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type !== Probe && fiber.type !== "span") return;
      const isProbe = fiber.type === Probe;
      const key = isProbe
        ? `${fiber.memoizedProps.name}:${fiber.memoizedProps.generation}`
        : String(fiber.memoizedProps["data-probe"]);
      const identity = identities.get(key);
      if (!identity) throw new Error(`Missing deletion identity ${key}`);
      const identifier = isProbe ? identity.identifier : identity.hostIdentifier;
      record(`delete-${isProbe ? "probe" : "host"}:${key}:${getFiberById(identifier) === fiber}`);
    },
  });
  const refOff = returnsCleanup ? "ref-cleanup" : "ref-null";
  const getCommitLabel = (rows: StrictProbeProps[], key: string, count: number): string =>
    rows
      .map((row) => `${getKey(row)}:${getKey(row) === key ? count : counts.get(getKey(row))}`)
      .join(",");
  const getMountTrace = (
    row: StrictProbeProps,
    rows: StrictProbeProps[],
    isReplayed: boolean,
    replaysApp = false,
  ): string[] => {
    const key = getKey(row);
    const label = `${key}:0`;
    const firstCommit = getCommitLabel(rows, key, 0);
    const secondCommit = getCommitLabel(rows, key, 1);
    const appPassive = `app-passive:${rows.map(getKey).join(",")}`;
    return [
      `insertion-on:${label}:true:absent`,
      `ref-on:${key}:true:true`,
      `layout-on:${label}:true:true`,
      `commit:${firstCommit}`,
      `phase:${label}:mount`,
      `passive-on:${label}:true:true`,
      appPassive,
      ...(isReplayed
        ? [
            `layout-off:${label}:true:true`,
            ...(!isPassiveUpdate ? [`schedule:${label}`] : []),
            `${refOff}:${key}:true:true`,
            `passive-off:${label}:true:true`,
            ...(isPassiveUpdate ? [`schedule:${label}`] : []),
            `ref-on:${key}:true:true`,
            `layout-on:${label}:true:true`,
            `passive-on:${label}:true:true`,
            ...(replaysApp ? [appPassive] : []),
          ]
        : []),
      `post:${firstCommit}`,
      ...(isReplayed
        ? [
            `insertion-off:${label}:true:true`,
            `insertion-on:${key}:1:true:true`,
            `layout-off:${label}:true:true`,
            `layout-on:${key}:1:true:true`,
            `commit:${secondCommit}`,
            `phase:${key}:1:update`,
            `passive-off:${label}:true:true`,
            `passive-on:${key}:1:true:true`,
            `post:${secondCommit}`,
          ]
        : []),
    ];
  };
  const getDeleteTrace = (row: StrictProbeProps): string[] => {
    const key = getKey(row);
    const label = `${key}:${counts.get(key)}`;
    return [
      `delete-probe:${key}:true`,
      `insertion-off:${label}:false:true`,
      `layout-off:${label}:false:true`,
      `delete-host:${key}:true`,
      `${refOff}:${key}:false:false`,
    ];
  };
  const render = async (rows: StrictProbeProps[]): Promise<void> => {
    const app = jsx(App, { rows });
    await harness.render(isRootStrict ? jsx(React.StrictMode, { children: app }) : app);
  };
  const check = (rows: StrictProbeProps[], portalOrder: string[]): void => {
    const fibers = [...getRows(harness.getRoot().current), ...getRows(control.getRoot().current)];
    expect(
      fibers.map((fiber) => `${fiber.memoizedProps.name}:${fiber.memoizedProps.generation}`),
    ).toEqual([...rows.map(getKey), "control:0"]);
    for (const fiber of fibers) {
      const key = `${fiber.memoizedProps.name}:${fiber.memoizedProps.generation}`;
      const hostFiber = getFiberPreorder(fiber).find((candidate) => candidate.type === "span");
      const host = hostFiber?.stateNode;
      const token = fiber.memoizedState?.next?.memoizedState;
      if (
        !hostFiber ||
        !(host instanceof HTMLSpanElement) ||
        typeof token !== "object" ||
        token === null
      )
        throw new Error("Missing live identity");
      const previous = identities.get(key);
      const identifier = getFiberId(fiber);
      const hostIdentifier = getFiberId(hostFiber);
      if (previous) {
        expect(identifier).toBe(previous.identifier);
        expect(hostIdentifier).toBe(previous.hostIdentifier);
        expect(host === previous.host).toBe(true);
        expect(token === previous.token).toBe(true);
        expect(getLatestFiber(previous.fiber) === fiber).toBe(true);
        expect(getLatestFiber(previous.hostFiber) === hostFiber).toBe(true);
      } else identities.set(key, { fiber, hostFiber, host, identifier, hostIdentifier, token });
      expect(getFiberById(identifier) === fiber).toBe(true);
      expect(getFiberById(hostIdentifier) === hostFiber).toBe(true);
      expect(host.textContent).toBe(`${key}:${counts.get(key)}`);
      expect(host.isConnected).toBe(true);
    }
    expect([...target.children].map((host) => host.getAttribute("data-probe"))).toEqual(
      portalOrder,
    );
    for (const identifier of retired) expect(getFiberById(identifier)).toBeNull();
  };
  const retire = (row: StrictProbeProps): void => {
    const key = getKey(row);
    const identity = identities.get(key);
    if (!identity) throw new Error(`Missing retired identity ${key}`);
    retired.add(identity.identifier);
    retired.add(identity.hostIdentifier);
    expect(identity.host.isConnected).toBe(false);
    expect(getFiber(identity.host)).toBeNull();
    expect(getFiberById(identity.identifier)).toBeNull();
    expect(getFiberById(identity.hostIdentifier)).toBeNull();
    identities.delete(key);
  };
  try {
    await control.render(jsx(Row, { name: "control", generation: 0 }));
    counts.set("control:0", 0);
    expect(trace.splice(0)).toEqual([
      "insertion-on:control:0:0:true:absent",
      "ref-on:control:0:true:true",
      "layout-on:control:0:0:true:true",
      "passive-on:control:0:0:true:true",
    ]);
    expect(bodies).toEqual(new Set(["control:0:0"]));
    bodies.clear();
    await render(schedule[0]);
    expect(trace.splice(0)).toEqual(
      getMountTrace(initial, schedule[0], isRootStrict, isRootStrict),
    );
    expect(bodies).toEqual(new Set(isRootStrict ? ["a:0:0", "a:0:1"] : ["a:0:0"]));
    bodies.clear();
    counts.set("a:0", isRootStrict ? 1 : 0);
    check(schedule[0], ["control:0", "a:0"]);
    scheduledKey = "b:0";
    await render(schedule[1]);
    expect(trace.splice(0)).toEqual(getMountTrace(inserted, schedule[1], true));
    expect(bodies).toEqual(new Set(["b:0:0", "b:0:1"]));
    bodies.clear();
    counts.set("b:0", 1);
    check(schedule[1], ["control:0", "a:0", "b:0"]);
    scheduledKey = null;
    await render(schedule[2]);
    expect(trace.splice(0)).toEqual([
      `commit:b:0:1,a:0:${counts.get("a:0")}`,
      "app-passive:b:0,a:0",
      `post:b:0:1,a:0:${counts.get("a:0")}`,
    ]);
    expect(bodies.size).toBe(0);
    check(schedule[2], ["control:0", "a:0", "b:0"]);
    scheduledKey = "a:1";
    const replacedIdentity = identities.get("a:0");
    if (!replacedIdentity) throw new Error("Missing replacement identity");
    await render(schedule[3]);
    const replacementTrace = getMountTrace(replacement, schedule[3], true);
    const passiveIndex = replacementTrace.indexOf("passive-on:a:1:0:true:true");
    replacementTrace.splice(passiveIndex, 0, `passive-off:a:0:${counts.get("a:0")}:false:false`);
    expect(trace.splice(0)).toEqual([...getDeleteTrace(initial), ...replacementTrace]);
    retire(initial);
    counts.set("a:1", 1);
    expect(bodies).toEqual(new Set(["a:1:0", "a:1:1"]));
    bodies.clear();
    check(schedule[3], ["control:0", "b:0", "a:1"]);
    const replacementIdentity = identities.get("a:1");
    if (!replacementIdentity) throw new Error("Missing replacement mount");
    expect(replacementIdentity.token === replacedIdentity.token).toBe(false);
    expect(replacementIdentity.host === replacedIdentity.host).toBe(false);
    expect(replacementIdentity.identifier).not.toBe(replacedIdentity.identifier);
    expect(replacementIdentity.hostIdentifier).not.toBe(replacedIdentity.hostIdentifier);
    scheduledKey = null;
    await harness.render(null);
    expect(trace.splice(0)).toEqual([
      ...schedule[3].flatMap(getDeleteTrace),
      "commit:",
      ...schedule[3].map((row) => `passive-off:${getKey(row)}:1:false:false`),
      "post:",
    ]);
    for (const row of schedule[3]) retire(row);
    expect(_fiberRoots.has(harness.getRoot())).toBe(false);
    expect(_fiberRoots.has(control.getRoot())).toBe(true);
    check([], ["control:0"]);
    await control.render(null);
    expect(trace.splice(0)).toEqual([
      ...getDeleteTrace({ name: "control", generation: 0 }),
      "passive-off:control:0:0:false:false",
    ]);
    retire({ name: "control", generation: 0 });
    expect(target.children).toHaveLength(0);
    return transcript;
  } finally {
    target.remove();
  }
};

it.each(
  [false, true].flatMap((isRootStrict) =>
    [false, true].flatMap((returnsCleanup) =>
      [false, true].map((isPassiveUpdate) => ({ isRootStrict, returnsCleanup, isPassiveUpdate })),
    ),
  ),
)(
  "replays Strict Mode identity, root $isRootStrict, cleanup ref $returnsCleanup, passive update $isPassiveUpdate",
  async (options) => {
    expect(await runStrictEffects(options)).toEqual(await runStrictEffects(options));
  },
);
