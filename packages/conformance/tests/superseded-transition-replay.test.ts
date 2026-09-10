import * as React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
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
import { expect, it, vi } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";

interface SupersededState {
  value: number;
  keys: readonly string[];
}
interface SupersededRowProps {
  name: string;
  value: number;
}
interface SupersededToken {
  name: string;
}
interface SupersededAttempt extends SupersededRowProps {
  fiber: Fiber;
  token: SupersededToken;
}
interface SupersededIdentity {
  fiber: Fiber;
  host: HTMLSpanElement;
  identifier: number;
  token: SupersededToken;
}

const runSupersededTransition = async (
  roles: string[],
  rejectsWakeables: boolean,
  completesTransition: boolean,
): Promise<string[]> => {
  const [firstBlocked, secondBlocked, deleted] = roles;
  const failure = new Error("superseded wakeable rejected");
  const observerFailure = new Error("superseded deletion observer failed");
  const caught: unknown[] = [];
  const reports: unknown[] = [];
  const transcript: string[] = [];
  const trace: string[] = [];
  const attempts: SupersededAttempt[] = [];
  const renderedRows = new Set<string>();
  const commitRenders: string[][] = [];
  const commitRoots: Fiber[] = [];
  const stableRenders = new Set<string>();
  const suspendedValues = new Set<number>();
  const failedReads = new Set<number>();
  const identifiers = new Map<string, number>();
  const resources = [1, 2].map(() => ({
    ...Promise.withResolvers<void>(),
    isSettled: false,
    isRejected: false,
  }));
  const schedule: readonly SupersededState[] = Object.freeze([
    { value: 0, keys: Object.freeze(["a", "b", "c"]) },
    { value: 1, keys: Object.freeze([secondBlocked, firstBlocked, deleted]) },
    { value: 2, keys: Object.freeze([deleted, secondBlocked, firstBlocked]) },
    { value: 3, keys: Object.freeze([firstBlocked, secondBlocked]) },
    { value: 4, keys: Object.freeze([secondBlocked, firstBlocked, deleted]) },
  ]);
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const harness = createRenderHarness({
    onCaughtError: (error) => {
      caught.push(error);
      record("caught");
    },
  });
  const control = createRenderHarness();
  let update: React.Dispatch<React.SetStateAction<SupersededState>> = () => {
    throw new Error("App has not mounted");
  };
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const Stable = React.memo(() => {
    stableRenders.add("stable");
    return jsx("aside", { children: "stable" });
  });
  const Row = ({ name, value }: SupersededRowProps) => {
    const fiber = getRenderingFiber();
    if (!fiber) throw new Error("Missing rendering fiber");
    const [token] = React.useState<SupersededToken>(() => ({ name }));
    attempts.push({ name, value, fiber, token });
    if (name !== "control") renderedRows.add(`${name}:${value}`);
    React.useLayoutEffect(() => {
      const identifier = getFiberId(fiber);
      identifiers.set(name, identifier);
      record(`layout-on:${name}:${value}:${getLatestFiber(fiber) === fiber}`);
      return () => {
        record(`layout-off:${name}:${value}:${getFiberById(identifier) === null}`);
      };
    }, [name, value]);
    React.useEffect(() => {
      record(`passive-on:${name}:${value}`);
      return () => {
        record(`passive-off:${name}:${value}:${getFiberById(getIdentifier(name)) === null}`);
      };
    }, [name, value]);
    if ((value === 1 && name === firstBlocked) || (value === 2 && name === secondBlocked)) {
      const resource = resources[value - 1];
      if (!resource.isSettled) {
        suspendedValues.add(value);
        throw resource.promise;
      }
      if (resource.isRejected) {
        failedReads.add(value);
        throw failure;
      }
    }
    return jsx("span", { "data-row": name, children: `${name}:${value}` });
  };
  const App = () => {
    const [state, setState] = React.useState(schedule[0]);
    update = setState;
    return jsxs(React.Fragment, {
      children: [
        jsx(Stable, {}),
        jsx(React.Suspense, {
          fallback: jsx("b", { children: "unexpected loading" }),
          children: state.keys.map((name) => jsx(Row, { name, value: state.value }, name)),
        }),
      ],
    });
  };
  const getIdentifier = (name: string): number => {
    const identifier = identifiers.get(name);
    if (identifier === undefined) throw new Error(`Missing identifier ${name}`);
    return identifier;
  };
  const getRows = (): Fiber[] =>
    getFiberPreorder(harness.getRoot().current).filter((fiber) => fiber.type === Row);
  const getRow = (name: string): Fiber => {
    const fiber = getRows().find((candidate) => candidate.memoizedProps.name === name);
    if (!fiber) throw new Error(`Missing row ${name}`);
    return fiber;
  };
  const getAttempt = (name: string, value: number): SupersededAttempt => {
    const attempt = attempts.find(
      (candidate) => candidate.name === name && candidate.value === value,
    );
    if (!attempt) throw new Error(`Missing render attempt ${name}:${value}`);
    return attempt;
  };
  const getHost = (fiber: Fiber): HTMLSpanElement => {
    const host = fiber.child?.stateNode;
    if (!(host instanceof HTMLSpanElement)) throw new Error("Missing committed row host");
    return host;
  };
  const checkDOM = (state: SupersededState): void => {
    expect(harness.container.textContent).toBe(
      `stable${state.keys.map((name) => `${name}:${state.value}`).join("")}`,
    );
    expect(
      [...harness.container.querySelectorAll<HTMLSpanElement>("span")].map(
        (host) => host.dataset.row,
      ),
    ).toEqual(state.keys);
  };
  const getCommit = (state: SupersededState): string[] => [
    `commit:${state.keys.map((name) => `${name}:${state.value}`).join(",")}`,
    ...state.keys.map(
      (name) =>
        `phase:${name}:${state.value}:${state.value === 0 || (state.value === 4 && name === deleted) ? "mount" : "update"}`,
    ),
  ];
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((_message: unknown, error: unknown) => {
      reports.push(error);
      record(`report:${error === observerFailure}`);
      throw new Error("superseded reporter failed");
    });
  using _observer = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      if (!("containerInfo" in root) || root.containerInfo !== harness.container) return;
      const rows = getFiberPreorder(root.current).filter((fiber) => fiber.type === Row);
      record(
        `commit:${rows.map((fiber) => `${fiber.memoizedProps.name}:${fiber.memoizedProps.value}`).join(",")}`,
      );
      commitRoots.push(root.current);
      commitRenders.push([...renderedRows]);
      renderedRows.clear();
      traverseRenderedFibers(commitRoots.length % 2 === 0 ? root : root.current, (fiber, phase) => {
        if (fiber.type === Row)
          record(`phase:${fiber.memoizedProps.name}:${fiber.memoizedProps.value}:${phase}`);
      });
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type !== Row) return;
      const { name, value } = fiber.memoizedProps;
      record(`delete:${name}:${value}:${getFiberById(getIdentifier(String(name))) === fiber}`);
      throw observerFailure;
    },
  });
  await control.render(jsx(Row, { name: "control", value: 0 }));
  expect(trace.splice(0)).toEqual(["layout-on:control:0:true", "passive-on:control:0"]);
  const controlFiber = getFiberPreorder(control.getRoot().current).find(
    (fiber) => fiber.type === Row,
  );
  if (!controlFiber) throw new Error("Missing control row");
  const controlHost = getHost(controlFiber);
  await harness.render(jsx(App, {}));
  expect(trace.splice(0)).toEqual([
    ...schedule[0].keys.map((name) => `layout-on:${name}:0:true`),
    ...getCommit(schedule[0]),
    ...schedule[0].keys.map((name) => `passive-on:${name}:0`),
  ]);
  expect(commitRenders.splice(0)).toEqual([schedule[0].keys.map((name) => `${name}:0`)]);
  expect(stableRenders).toEqual(new Set(["stable"]));
  stableRenders.clear();
  const originalRoot = harness.getRoot().current;
  const originals = new Map<string, SupersededIdentity>(
    getRows().map((fiber) => {
      const name = String(fiber.memoizedProps.name);
      return [
        name,
        {
          fiber,
          host: getHost(fiber),
          identifier: getFiberId(fiber),
          token: getAttempt(name, 0).token,
        },
      ];
    }),
  );
  const getOriginal = (name: string): SupersededIdentity => {
    const identity = originals.get(name);
    if (!identity) throw new Error(`Missing original identity ${name}`);
    return identity;
  };
  const checkUncommitted = (): void => {
    expect(trace).toEqual([]);
    checkDOM(schedule[0]);
    expect(harness.getRoot().current === originalRoot).toBe(true);
    expect(getRows().map((fiber) => fiber.memoizedProps.name)).toEqual(schedule[0].keys);
    for (const [name, identity] of originals) {
      expect(getRow(name) === identity.fiber).toBe(true);
      expect(getFiberById(identity.identifier) === identity.fiber).toBe(true);
      expect(getHost(identity.fiber) === identity.host).toBe(true);
      expect(identity.host.textContent).toBe(`${name}:0`);
    }
    expect(stableRenders.size).toBe(0);
  };
  for (const value of [1, 2]) {
    await React.act(async () => React.startTransition(() => update(schedule[value])));
    expect(suspendedValues.has(value)).toBe(true);
    checkUncommitted();
    const blocked = getAttempt(value === 1 ? firstBlocked : secondBlocked, value);
    expect(blocked.fiber.alternate === getOriginal(blocked.name).fiber).toBe(true);
    expect(getFiberId(blocked.fiber)).toBe(getOriginal(blocked.name).identifier);
    expect(getLatestFiber(blocked.fiber) === getOriginal(blocked.name).fiber).toBe(true);
  }
  for (const attempt of attempts.filter(
    (candidate) => candidate.value === 1 || candidate.value === 2,
  )) {
    const original = getOriginal(attempt.name);
    expect(getLatestFiber(attempt.fiber) === original.fiber).toBe(true);
    expect(getFiberId(attempt.fiber)).toBe(original.identifier);
    expect(attempt.token === original.token).toBe(true);
  }
  const reused = getAttempt(secondBlocked, 1);
  const superseding = getAttempt(secondBlocked, 2);
  const discarded = getAttempt(deleted, 2);
  expect(reused.fiber === superseding.fiber).toBe(true);
  expect(reused.token === superseding.token).toBe(true);
  expect(reused.fiber.pendingProps.value).toBe(2);
  expect(discarded.fiber.alternate === getOriginal(deleted).fiber).toBe(true);
  expect(getFiberId(discarded.fiber)).toBe(getOriginal(deleted).identifier);
  const settle = async (index: number): Promise<void> => {
    const resource = resources[index];
    const isRejected = rejectsWakeables && !(completesTransition && index === 1);
    await React.act(async () => {
      resource.isSettled = true;
      resource.isRejected = isRejected;
      if (isRejected) {
        resource.reject(failure);
        await expect(resource.promise).rejects.toBe(failure);
      } else {
        resource.resolve();
        await expect(resource.promise).resolves.toBeUndefined();
      }
    });
    transcript.push(`settle:${index}:${isRejected ? "reject" : "fulfill"}`);
  };
  expect(commitRenders).toEqual([]);
  if (completesTransition) {
    renderedRows.clear();
    await settle(1);
    expect(trace.splice(0)).toEqual([
      ...schedule[2].keys.map((name) => `layout-off:${name}:0:false`),
      ...schedule[2].keys.map((name) => `layout-on:${name}:2:true`),
      ...getCommit(schedule[2]),
      ...schedule[2].keys.map((name) => `passive-off:${name}:0:false`),
      ...schedule[2].keys.map((name) => `passive-on:${name}:2`),
    ]);
    expect(commitRenders.splice(0)).toEqual([schedule[2].keys.map((name) => `${name}:2`)]);
    checkDOM(schedule[2]);
    for (const name of schedule[2].keys) {
      const current = getRow(name);
      const original = getOriginal(name);
      expect(current === getAttempt(name, 2).fiber).toBe(true);
      expect(getLatestFiber(original.fiber) === current).toBe(true);
      expect(getFiberById(original.identifier) === current).toBe(true);
      expect(getHost(current) === original.host).toBe(true);
    }
  } else {
    await settle(0);
    checkUncommitted();
    expect(getLatestFiber(reused.fiber) === getOriginal(secondBlocked).fiber).toBe(true);
  }
  const previousValue = completesTransition ? 2 : 0;
  renderedRows.clear();
  await React.act(async () => update(schedule[3]));
  expect(trace.splice(0)).toEqual([
    `delete:${deleted}:${previousValue}:true`,
    "report:true",
    `layout-off:${deleted}:${previousValue}:true`,
    ...schedule[3].keys.map((name) => `layout-off:${name}:${previousValue}:false`),
    ...schedule[3].keys.map((name) => `layout-on:${name}:3:true`),
    ...getCommit(schedule[3]),
    `passive-off:${deleted}:${previousValue}:true`,
    ...schedule[3].keys.map((name) => `passive-off:${name}:${previousValue}:false`),
    ...schedule[3].keys.map((name) => `passive-on:${name}:3`),
    ...(completesTransition ? [] : [getCommit(schedule[3])[0]]),
  ]);
  expect(commitRenders.splice(0)).toEqual([
    schedule[3].keys.map((name) => `${name}:3`),
    ...(completesTransition ? [] : [[]]),
  ]);
  expect(commitRoots).toHaveLength(3);
  expect(commitRoots[1] === originalRoot.alternate).toBe(true);
  expect(commitRoots[2] === originalRoot).toBe(true);
  checkDOM(schedule[3]);
  expect(
    getRow(secondBlocked) ===
      (completesTransition ? getOriginal(secondBlocked).fiber : reused.fiber),
  ).toBe(true);
  expect(reused.fiber.memoizedProps.value).toBe(completesTransition ? 2 : 3);
  expect(getFiberById(getOriginal(deleted).identifier)).toBeNull();
  expect(getFiber(getOriginal(deleted).host)).toBeNull();
  expect(discarded.fiber.alternate).toBeNull();
  expect(getOriginal(deleted).host.isConnected).toBe(false);
  const urgentRoot = harness.getRoot().current;
  await settle(completesTransition ? 0 : 1);
  expect(trace).toEqual([]);
  expect(harness.getRoot().current === urgentRoot).toBe(true);
  expect(commitRenders).toEqual([]);
  expect(renderedRows.size).toBe(0);
  expect(failedReads.size).toBe(0);
  expect(caught).toEqual([]);
  for (const name of schedule[3].keys) {
    const current = getRow(name);
    const original = getOriginal(name);
    expect(getLatestFiber(original.fiber) === current).toBe(true);
    expect(getFiberById(original.identifier) === current).toBe(true);
    expect(getHost(current) === original.host).toBe(true);
    expect(getAttempt(name, 3).token === original.token).toBe(true);
  }
  expect(stableRenders.size).toBe(0);
  await React.act(async () => update(schedule[4]));
  expect(trace.splice(0)).toEqual([
    ...schedule[4].keys
      .filter((name) => name !== deleted)
      .map((name) => `layout-off:${name}:3:false`),
    ...schedule[4].keys.map((name) => `layout-on:${name}:4:true`),
    ...getCommit(schedule[4]),
    ...schedule[4].keys
      .filter((name) => name !== deleted)
      .map((name) => `passive-off:${name}:3:false`),
    ...schedule[4].keys.map((name) => `passive-on:${name}:4`),
  ]);
  expect(commitRenders.splice(0)).toEqual([schedule[4].keys.map((name) => `${name}:4`)]);
  checkDOM(schedule[4]);
  expect(getLatestFiber(reused.fiber) === getRow(secondBlocked)).toBe(true);
  const remounted = getRow(deleted);
  expect(remounted === discarded.fiber).toBe(false);
  expect(getFiberId(remounted)).not.toBe(getOriginal(deleted).identifier);
  expect(getHost(remounted) === getOriginal(deleted).host).toBe(false);
  expect(getAttempt(deleted, 4).token === getOriginal(deleted).token).toBe(false);
  expect(getFiberById(getOriginal(deleted).identifier)).toBeNull();
  expect(getRows().map((fiber) => fiber.memoizedProps.name)).toEqual(schedule[4].keys);
  for (const name of schedule[3].keys) {
    const current = getRow(name);
    const original = getOriginal(name);
    expect(current === (completesTransition ? original.fiber.alternate : original.fiber)).toBe(
      true,
    );
    expect(getFiberId(current)).toBe(original.identifier);
    expect(getHost(current) === original.host).toBe(true);
    expect(getAttempt(name, 4).token === original.token).toBe(true);
  }
  const stable = getFiberPreorder(harness.getRoot().current).find(
    (fiber) => fiber.elementType === Stable,
  );
  if (!stable?.alternate) throw new Error("Missing stable bailout alternate");
  expect(stable.child === stable.alternate.child).toBe(true);
  expect(stableRenders.size).toBe(0);
  expect(getFiberById(getIdentifier("control")) === controlFiber).toBe(true);
  expect(getHost(controlFiber) === controlHost).toBe(true);
  expect(controlHost.textContent).toBe("control:0");
  await harness.render(null);
  expect(trace.splice(0)).toEqual([
    ...schedule[4].keys.flatMap((name) => [
      `delete:${name}:4:true`,
      "report:true",
      `layout-off:${name}:4:true`,
    ]),
    "commit:",
    ...schedule[4].keys.map((name) => `passive-off:${name}:4:true`),
  ]);
  expect(_fiberRoots.has(harness.getRoot())).toBe(false);
  expect(_fiberRoots.has(control.getRoot())).toBe(true);
  expect(getFiberById(getIdentifier("control")) === controlFiber).toBe(true);
  await control.render(null);
  expect(trace.splice(0)).toEqual([
    "delete:control:0:true",
    "report:true",
    "layout-off:control:0:true",
    "passive-off:control:0:true",
  ]);
  for (const identifier of identifiers.values()) expect(getFiberById(identifier)).toBeNull();
  expect(reports).toHaveLength(5);
  expect(reports.every((error) => error === observerFailure)).toBe(true);
  expect(caught).toEqual([]);
  return transcript;
};

it.each(
  [
    ["a", "b", "c"],
    ["a", "c", "b"],
    ["b", "a", "c"],
    ["b", "c", "a"],
    ["c", "a", "b"],
    ["c", "b", "a"],
  ].flatMap((roles) =>
    [false, true].flatMap((rejectsWakeables) =>
      [false, true].map((completesTransition) => ({
        roles,
        rejectsWakeables,
        completesTransition,
      })),
    ),
  ),
)(
  "replays superseded work-in-progress reuse, roles $roles, reject wakeables $rejectsWakeables, complete newer work $completesTransition",
  async ({ roles, rejectsWakeables, completesTransition }) => {
    expect(await runSupersededTransition(roles, rejectsWakeables, completesTransition)).toEqual(
      await runSupersededTransition(roles, rejectsWakeables, completesTransition),
    );
  },
);
