import * as React from "react";
import { jsx } from "react/jsx-runtime";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  _fiberRoots,
  getFiber,
  getFiberById,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  getReactWorkTags,
  instrument,
  isHostFiber,
  traverseRenderedFibers,
  type Fiber,
  type FiberRoot,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";

interface ResourceProps {
  owner: number;
  epoch: number;
  label: string;
  slot: Element;
}
interface ResourceIdentity {
  fiber: Fiber;
  identifier: number;
  token: object;
}
interface StyleIdentity {
  fiber: Fiber;
  identifier: number;
  node: HTMLStyleElement;
  resource: object;
}
interface ResourceOptions {
  owner: number;
  crossesShadow: boolean;
  deletesHidden: boolean;
  returnsCleanup: boolean;
}

const runResources = async ({
  owner,
  crossesShadow,
  deletesHidden,
  returnsCleanup,
}: ResourceOptions): Promise<string[]> => {
  const other = 1 - owner;
  const hosts = [0, 1].map(() => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    return host;
  });
  const shadows = hosts.map((host) => host.attachShadow({ mode: "open" }));
  const containers = [0, 1, 2].map((checkedOwner) => {
    const container = document.createElement("div");
    shadows[checkedOwner === 2 ? 1 : 0].appendChild(container);
    return container;
  });
  const roots = containers.map((container) => createRoot(container));
  const committedRoots = new Map<number, FiberRoot>();
  const foreignTarget = {};
  const identities = new Map<string, ResourceIdentity>();
  const styles = new Map<number, StyleIdentity>();
  const trace: string[] = [];
  const transcript: string[] = [];
  const observerFailure = new Error("resource deletion observer failed");
  const reporterFailure = new Error("resource reporter failed");
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const getRoot = (checkedOwner: number): FiberRoot => {
    const root = committedRoots.get(checkedOwner);
    if (!root) throw new Error("Missing resource root");
    return root;
  };
  const getResourceCount = (resource: object | undefined): unknown =>
    resource ? Reflect.get(resource, "count") : -1;
  const getIdentity = (checkedOwner: number, epoch: number): ResourceIdentity => {
    const identity = identities.get(`${checkedOwner}:${epoch}`);
    if (!identity) throw new Error("Missing resource identity");
    return identity;
  };
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const ProbeBody = ({ owner: checkedOwner, epoch, label, slot }: ResourceProps) => {
    const [token] = React.useState(() => ({}));
    const rendering = getRenderingFiber();
    if (!rendering) throw new Error("Missing rendering resource probe");
    const name = `${checkedOwner}:${epoch}`;
    const identifier = getFiberId(rendering);
    if (!identities.has(name)) identities.set(name, { fiber: rendering, identifier, token });
    record(`render:${name}:${label}`);
    const styleIdentifier = React.useRef(-1);
    const ref = React.useCallback(
      (node: HTMLStyleElement | null) => {
        if (!node) {
          record(
            `ref-off:${name}:${getFiberById(styleIdentifier.current) !== null}:${getResourceCount(styles.get(styleIdentifier.current)?.resource)}`,
          );
          return;
        }
        const latest = getLatestFiber(rendering);
        const style = getFiberPreorder(latest).find((fiber) => fiber.type === "style");
        if (!style || !style.memoizedState) throw new Error("Missing acquired resource");
        const nextIdentifier = getFiberId(style);
        styleIdentifier.current = nextIdentifier;
        if (!styles.has(nextIdentifier))
          styles.set(nextIdentifier, {
            fiber: style,
            identifier: nextIdentifier,
            node,
            resource: style.memoizedState,
          });
        const hostLookup = getFiber(node);
        record(
          `ref-on:${name}:${style.stateNode === node}:${getFiberById(identifier) === latest}:${hostLookup?.memoizedProps["data-owner"] ?? "none"}:${getResourceCount(style.memoizedState)}`,
        );
        if (returnsCleanup)
          return () => {
            record(
              `ref-off:${name}:${getFiberById(nextIdentifier) !== null}:${getResourceCount(style.memoizedState ?? undefined)}`,
            );
          };
      },
      [checkedOwner, epoch],
    );
    React.useLayoutEffect(() => {
      record(`layout-on:${name}:${getFiberById(identifier) !== null}`);
      return () => {
        record(`layout-off:${name}:${getFiberById(identifier) !== null}`);
      };
    }, []);
    React.useEffect(() => {
      record(`passive-on:${name}:${getFiberById(identifier) !== null}`);
      return () => {
        record(`passive-off:${name}:${getFiberById(identifier) !== null}`);
      };
    }, []);
    return createPortal(
      jsx("style", {
        href: "shared",
        precedence: "base",
        "data-owner": checkedOwner,
        "data-epoch": epoch,
        children: `.probe { --owner: "${checkedOwner}:${label}"; }`,
        ref,
      }),
      slot,
    );
  };
  const Probe = React.memo(ProbeBody);
  const getSavedIdentifier = (fiber: Fiber): number => {
    if (fiber.type === ProbeBody)
      return (
        identities.get(`${fiber.memoizedProps.owner}:${fiber.memoizedProps.epoch}`)?.identifier ??
        -1
      );
    return (
      [...styles.values()].find((style) => style.fiber === fiber || style.fiber.alternate === fiber)
        ?.identifier ?? -1
    );
  };
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      record(`report:${message}:${error === observerFailure}`);
      throw reporterFailure;
    });
  using unsubscribe = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      const checkedOwner = containers.findIndex(
        (container) => "containerInfo" in root && root.containerInfo === container,
      );
      if (checkedOwner < 0) return;
      committedRoots.set(checkedOwner, root);
      record(`commit:${checkedOwner}:${_fiberRoots.has(root)}`);
      traverseRenderedFibers(checkedOwner === 0 ? root.current : root, (fiber, phase) => {
        if (fiber.type !== ProbeBody && fiber.type !== "style") return;
        record(
          `phase:${checkedOwner}:${fiber.type === "style" ? "style" : "probe"}:${phase}:${getFiberById(getSavedIdentifier(fiber)) === fiber}`,
        );
      });
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type !== ProbeBody && fiber.type !== "style") return;
      const props = fiber.memoizedProps;
      const checkedOwner = fiber.type === "style" ? props["data-owner"] : props.owner;
      const epoch = fiber.type === "style" ? props["data-epoch"] : props.epoch;
      if (!identities.has(`${checkedOwner}:${epoch}`)) return;
      record(
        `delete:${checkedOwner}:${epoch}:${fiber.type === "style" ? "style" : "probe"}:${getFiberById(getSavedIdentifier(fiber)) === fiber}${fiber.type === "style" ? `:${getResourceCount(fiber.memoizedState ?? undefined)}` : ""}`,
      );
      throw observerFailure;
    },
  });
  const tree = (
    checkedOwner: number,
    epoch = 0,
    label = "a",
    hidden = false,
    slot = containers[checkedOwner],
  ) =>
    jsx(React.Activity, {
      mode: hidden ? "hidden" : "visible",
      children: jsx(Probe, { owner: checkedOwner, epoch, label, slot }, String(epoch)),
    });
  const render = async (checkedOwner: number, children: React.ReactNode): Promise<void> => {
    await React.act(async () => roots[checkedOwner].render(children));
  };
  const checkTrace = (expected: string[]): void => {
    expect(trace.splice(0)).toEqual(expected);
  };
  const commit = (checkedOwner: number, phases: string[] = [], mounted = true): string[] => [
    `commit:${checkedOwner}:${mounted}`,
    ...phases.map((phase) => `phase:${checkedOwner}:${phase}:true`),
  ];
  const refOn = (
    checkedOwner: number,
    epoch: number,
    winner: number | null,
    count: number,
  ): string => `ref-on:${checkedOwner}:${epoch}:true:true:${winner ?? "none"}:${count}`;
  const mount = (
    checkedOwner: number,
    epoch: number,
    winner: number | null = null,
    count = 1,
  ): string[] => [
    `render:${checkedOwner}:${epoch}:a`,
    refOn(checkedOwner, epoch, winner, count),
    `layout-on:${checkedOwner}:${epoch}:true`,
    ...commit(checkedOwner, ["probe:mount", "style:mount"]),
    `passive-on:${checkedOwner}:${epoch}:true`,
  ];
  const deletion = (checkedOwner: number, epoch: number, hidden = false, count = 1): string[] => [
    `delete:${checkedOwner}:${epoch}:probe:true`,
    "report:Bippy instrumentation encountered an error::true",
    ...(hidden ? [] : [`layout-off:${checkedOwner}:${epoch}:false`]),
    `delete:${checkedOwner}:${epoch}:style:true:${count}`,
    "report:Bippy instrumentation encountered an error::true",
    ...(hidden ? [] : [`ref-off:${checkedOwner}:${epoch}:false:${count}`]),
    ...commit(checkedOwner, [], false),
    ...(hidden ? [] : [`passive-off:${checkedOwner}:${epoch}:false`]),
  ];
  const getStyle = (checkedOwner: number): Fiber => {
    const style = getFiberPreorder(getRoot(checkedOwner).current).find(
      (fiber) => fiber.type === "style",
    );
    if (!style) throw new Error("Missing committed style");
    return style;
  };
  const checkIdentity = (checkedOwner: number, epoch: number): StyleIdentity => {
    const identity = getIdentity(checkedOwner, epoch);
    const probe = getFiberPreorder(getRoot(checkedOwner).current).find(
      (fiber) => fiber.type === ProbeBody,
    );
    expect(getFiberById(identity.identifier)).toBe(probe);
    expect(getLatestFiber(identity.fiber)).toBe(probe);
    expect(probe?.memoizedState?.memoizedState).toBe(identity.token);
    if (probe?.alternate) expect(getLatestFiber(probe.alternate)).toBe(probe);
    const fiber = getStyle(checkedOwner);
    const style = styles.get(getFiberId(fiber));
    if (!style) throw new Error("Missing retained style");
    expect(fiber.tag).toBe(getReactWorkTags().HostHoistable);
    expect(isHostFiber(fiber)).toBe(true);
    expect(getLatestFiber(style.fiber)).toBe(fiber);
    if (fiber.alternate) expect(getLatestFiber(fiber.alternate)).toBe(fiber);
    expect(getFiberById(style.identifier)).toBe(fiber);
    expect(fiber.stateNode).toBe(style.node);
    expect(fiber.memoizedState).toBe(style.resource);
    return style;
  };
  const retire = (checkedOwner: number, epoch: number, style: StyleIdentity): void => {
    expect(getFiberById(getIdentity(checkedOwner, epoch).identifier)).toBeNull();
    expect(getFiberById(style.identifier)).toBeNull();
  };
  try {
    for (const checkedOwner of [0, 1, 2]) {
      await render(checkedOwner, tree(checkedOwner));
      checkTrace(mount(checkedOwner, 0, checkedOwner === 1 ? 0 : null, checkedOwner === 1 ? 2 : 1));
    }
    const initial = [0, 1, 2].map((checkedOwner) => checkIdentity(checkedOwner, 0));
    expect(initial[0].identifier).not.toBe(initial[1].identifier);
    expect(initial[0].node).toBe(initial[1].node);
    expect(initial[0].resource).toBe(initial[1].resource);
    expect(initial[2].node).not.toBe(initial[0].node);
    expect(initial[2].resource).not.toBe(initial[0].resource);
    const audit = (counts: number[], winners: Array<number | null>): void => {
      for (const index of [0, 1]) {
        const style = initial[index === 0 ? 0 : 2];
        expect(Reflect.get(style.resource, "type")).toBe("style");
        expect(Reflect.get(style.resource, "count")).toBe(counts[index]);
        expect(Reflect.get(style.resource, "instance")).toBe(style.node);
        expect([...shadows[index].querySelectorAll("style")]).toEqual([style.node]);
        expect(style.node.isConnected).toBe(true);
        expect(
          Object.keys(style.node).filter(
            (key) =>
              key.startsWith("__reactFiber") ||
              key.startsWith("__reactContainer$") ||
              key.startsWith("__reactInternalInstance$"),
          ),
        ).toEqual([]);
        expect(style.node.textContent).toBe(`.probe { --owner: "${index === 0 ? 0 : 2}:a"; }`);
        const winner = winners[index];
        expect(getFiber(style.node)).toBe(winner === null ? null : getStyle(winner));
        expect(getFiber(style.node, foreignTarget)).toBeNull();
      }
    };
    audit([2, 1], [0, 2]);
    await render(owner, tree(owner, 0, "b"));
    checkTrace([`render:${owner}:0:b`, ...commit(owner, ["probe:update", "style:update"])]);
    expect(checkIdentity(owner, 0)).toBe(initial[owner]);
    expect(getStyle(owner).memoizedProps.children).toBe(`.probe { --owner: "${owner}:b"; }`);
    audit([2, 1], [0, 2]);
    await render(owner, tree(owner, 0, "b"));
    checkTrace(commit(owner));
    await render(owner, tree(owner, 0, "b", true));
    checkTrace([
      `layout-off:${owner}:0:true`,
      `ref-off:${owner}:0:true:2`,
      ...commit(owner),
      `passive-off:${owner}:0:true`,
      ...commit(owner),
    ]);
    expect(checkIdentity(owner, 0)).toBe(initial[owner]);
    const activity = getFiberPreorder(getRoot(owner).current).find(
      (fiber) => fiber.elementType === React.Activity,
    );
    expect(activity?.memoizedProps.mode).toBe("hidden");
    expect(activity?.child?.tag).toBe(getReactWorkTags().OffscreenComponent);
    expect(activity?.child?.memoizedState).toBeTruthy();
    audit([2, 1], [0, 2]);
    if (!deletesHidden) {
      await render(owner, tree(owner, 0, "b"));
      checkTrace([
        refOn(owner, 0, 0, 2),
        `layout-on:${owner}:0:true`,
        ...commit(owner),
        `passive-on:${owner}:0:true`,
      ]);
    }
    await render(owner, null);
    checkTrace(deletion(owner, 0, deletesHidden, 2));
    retire(owner, 0, initial[owner]);
    audit([1, 1], [other, 2]);
    await render(owner, tree(owner, 1));
    checkTrace(mount(owner, 1, other, 2));
    const remount = checkIdentity(owner, 1);
    expect(remount.identifier).not.toBe(initial[owner].identifier);
    expect(remount.node).toBe(initial[owner].node);
    expect(getIdentity(owner, 1).token).not.toBe(getIdentity(owner, 0).token);
    audit([2, 1], [other, 2]);
    await render(owner, tree(owner, 1, "a", false, containers[crossesShadow ? 2 : other]));
    checkTrace([
      `render:${owner}:1:a`,
      `delete:${owner}:1:style:true:2`,
      "report:Bippy instrumentation encountered an error::true",
      `ref-off:${owner}:1:false:2`,
      refOn(owner, 1, crossesShadow ? 2 : other, 2),
      ...commit(owner, ["probe:update", "style:mount"]),
    ]);
    const relocated = checkIdentity(owner, 1);
    expect(relocated.identifier).not.toBe(remount.identifier);
    expect(getFiberById(remount.identifier)).toBeNull();
    expect(relocated.node).toBe(initial[crossesShadow ? 2 : 0].node);
    audit(crossesShadow ? [1, 2] : [2, 1], [other, 2]);
    await render(2, null);
    checkTrace(deletion(2, 0, false, crossesShadow ? 2 : 1));
    retire(2, 0, initial[2]);
    audit(crossesShadow ? [1, 1] : [2, 0], [other, crossesShadow ? owner : null]);
    await render(other, null);
    checkTrace(deletion(other, 0, false, crossesShadow ? 1 : 2));
    retire(other, 0, initial[other]);
    audit(crossesShadow ? [0, 1] : [1, 0], crossesShadow ? [null, owner] : [owner, null]);
    expect(checkIdentity(owner, 1)).toBe(relocated);
    await render(owner, null);
    checkTrace(deletion(owner, 1));
    retire(owner, 1, relocated);
    audit([0, 0], [null, null]);
    for (const checkedOwner of [2, owner]) {
      await render(checkedOwner, tree(checkedOwner, 2));
      checkTrace(mount(checkedOwner, 2));
    }
    const resurrected = checkIdentity(owner, 2);
    const control = checkIdentity(2, 2);
    expect(resurrected.node).toBe(initial[0].node);
    expect(control.node).toBe(initial[2].node);
    expect(resurrected.identifier).not.toBe(remount.identifier);
    expect(resurrected.identifier).not.toBe(relocated.identifier);
    expect(control.identifier).not.toBe(initial[2].identifier);
    expect(getIdentity(owner, 2).token).not.toBe(getIdentity(owner, 1).token);
    audit([1, 1], [owner, 2]);
    for (const checkedOwner of [owner, 2]) {
      await render(checkedOwner, null);
      checkTrace(deletion(checkedOwner, 2));
    }
    retire(owner, 2, resurrected);
    retire(2, 2, control);
    audit([0, 0], [null, null]);
    return [...transcript];
  } finally {
    unsubscribe();
    try {
      for (const root of roots) await React.act(async () => root.unmount());
      for (const root of committedRoots.values()) expect(_fiberRoots.has(root)).toBe(false);
      for (const style of styles.values()) expect(getFiberById(style.identifier)).toBeNull();
      for (const identity of identities.values())
        expect(getFiberById(identity.identifier)).toBeNull();
    } finally {
      for (const host of hosts) host.remove();
    }
  }
};

it.each(
  [0, 1].flatMap((owner) =>
    [false, true].flatMap((crossesShadow) =>
      [false, true].flatMap((deletesHidden) =>
        [false, true].map((returnsCleanup) => ({
          owner,
          crossesShadow,
          deletesHidden,
          returnsCleanup,
        })),
      ),
    ),
  ),
)(
  "replays shared resources, owner $owner, crosses shadow $crossesShadow, deletes hidden $deletesHidden, ref cleanup $returnsCleanup",
  async (options) => {
    expect(await runResources(options)).toEqual(await runResources(options));
  },
);
