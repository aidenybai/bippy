import * as React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
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
  type FiberRoot,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";

interface DeferredState {
  input: number;
  epoch: number;
}
interface DeferredOwnerProps {
  owner: number;
}
interface DeferredProps extends DeferredState, DeferredOwnerProps {}
interface DeferredRowProps {
  owner: number;
  epoch: number;
  kind: "preview" | "leaf";
  value: number;
}
interface DeferredIdentity {
  fiber: Fiber;
  identifier: number;
  token: object | null;
  host: HTMLSpanElement | null;
  hostIdentifier: number;
}
interface DeferredAttempt {
  owner: number;
  epoch: number;
  kind: string;
  value: number;
  fiber: Fiber;
  token: object;
}
interface DeferredGate extends PromiseWithResolvers<void> {
  ready: boolean;
  settled: boolean;
}
interface DeferredOptions {
  owner: number;
  initialTransition: boolean;
  completes: boolean;
}

const runDeferredValues = async ({
  owner,
  initialTransition,
  completes,
}: DeferredOptions): Promise<string[]> => {
  const containers = [0, 1].map(() => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    return container;
  });
  const roots = containers.map((container) => createRoot(container));
  const committedRoots = new Map<number, FiberRoot>();
  const setters = new Map<number, React.Dispatch<React.SetStateAction<DeferredState>>>();
  const identities = new Map<string, DeferredIdentity>();
  const attempts: DeferredAttempt[] = [];
  const blocked = new Set<number>();
  const subscriptions = new Set<string>();
  const gates = new Map<number, DeferredGate>(
    [1, 2, 5].map((value) => {
      const gate = { ...Promise.withResolvers<void>(), ready: false, settled: false };
      void gate.promise.then(() => {
        gate.settled = true;
      });
      return [value, gate];
    }),
  );
  const trace: string[] = [];
  const transcript: string[] = [];
  const observerFailure = new Error("deferred deletion observer failed");
  const reporterFailure = new Error("deferred reporter failed");
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const getRoot = (checkedOwner: number): FiberRoot => {
    const root = committedRoots.get(checkedOwner);
    if (!root) throw new Error("Missing deferred root");
    return root;
  };
  const getIdentity = (name: string): DeferredIdentity => {
    const identity = identities.get(name);
    if (!identity) throw new Error(`Missing deferred identity ${name}`);
    return identity;
  };
  const saveIdentity = (name: string, fiber: Fiber, token: object | null): DeferredIdentity => {
    let identity = identities.get(name);
    if (!identity) {
      identity = { fiber, identifier: getFiberId(fiber), token, host: null, hostIdentifier: -1 };
      identities.set(name, identity);
    }
    return identity;
  };
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rendering oracle");
  const getRenderingFiber = (): Fiber => {
    const fiber = renderer.getCurrentFiber?.();
    if (!fiber) throw new Error("Missing deferred rendering fiber");
    return fiber;
  };
  const RowBody = ({ owner: checkedOwner, epoch, kind, value }: DeferredRowProps) => {
    const [token] = React.useState(() => ({}));
    const fiber = getRenderingFiber();
    const name = `${checkedOwner}:${epoch}:${kind}`;
    attempts.push({ owner: checkedOwner, epoch, kind, value, fiber, token });
    const ref = React.useCallback(
      (host: HTMLSpanElement | null) => {
        if (!host) {
          record(`ref-off:${name}:${getFiberById(getIdentity(name).hostIdentifier) !== null}`);
          return;
        }
        const identity = saveIdentity(name, fiber, token);
        const hostFiber = getFiber(host);
        if (!hostFiber) throw new Error("Missing deferred host");
        identity.host = host;
        identity.hostIdentifier = getFiberId(hostFiber);
        record(`ref-on:${name}`);
      },
      [checkedOwner, epoch, kind],
    );
    React.useLayoutEffect(() => {
      const identity = saveIdentity(name, fiber, token);
      record(`row-on:${name}:${value}:${getFiberById(identity.identifier) !== null}`);
      return () => {
        record(`row-off:${name}:${value}:${getFiberById(identity.identifier) !== null}`);
      };
    }, [value]);
    React.useEffect(() => {
      const identity = getIdentity(name);
      expect(subscriptions.has(name)).toBe(false);
      subscriptions.add(name);
      record(`passive-on:${name}:${value}:${getFiberById(identity.identifier) !== null}`);
      return () => {
        expect(subscriptions.delete(name)).toBe(true);
        record(`passive-off:${name}:${value}:${getFiberById(identity.identifier) !== null}`);
      };
    }, [value]);
    const gate = gates.get(value);
    if (checkedOwner === owner && kind === "leaf" && gate && !gate.ready) {
      blocked.add(value);
      throw gate.promise;
    }
    return jsx("span", {
      "data-owner": checkedOwner,
      "data-epoch": epoch,
      "data-kind": kind,
      children: `${kind}:${value}`,
      ref,
    });
  };
  const Row = React.memo(RowBody);
  const describeContent = (fiber: Fiber | null): string =>
    fiber ? `${fiber.memoizedProps.input}/${fiber.memoizedState?.next?.memoizedState}` : "none";
  const Content = ({ owner: checkedOwner, input, epoch }: DeferredProps) => {
    const [token] = React.useState(() => ({}));
    const deferred = React.useDeferredValue(input, -1);
    const fiber = getRenderingFiber();
    const name = `${checkedOwner}:${epoch}:content`;
    attempts.push({ owner: checkedOwner, epoch, kind: "content", value: deferred, fiber, token });
    React.useLayoutEffect(() => {
      const identity = saveIdentity(name, fiber, token);
      record(
        `content-on:${name}:${input}/${deferred}:${describeContent(getFiberById(identity.identifier))}`,
      );
      return () => {
        record(
          `content-off:${name}:${input}/${deferred}:${describeContent(getFiberById(identity.identifier))}`,
        );
      };
    }, [input, deferred]);
    return jsx(Row, { owner: checkedOwner, epoch, kind: "leaf", value: deferred });
  };
  const Shell = ({ owner: checkedOwner, input, epoch }: DeferredProps) => {
    const showContent = React.useDeferredValue(true, checkedOwner === owner ? false : undefined);
    const fiber = getRenderingFiber();
    React.useLayoutEffect(() => {
      saveIdentity(`${checkedOwner}:${epoch}:shell`, fiber, null);
    }, []);
    return jsxs(React.Fragment, {
      children: [
        jsx("header", { children: `${checkedOwner}:${epoch}:${input}|` }),
        showContent
          ? jsx(Content, { owner: checkedOwner, input, epoch })
          : jsx(Row, { owner: checkedOwner, epoch, kind: "preview", value: input }),
      ],
    });
  };
  const App = ({ owner: checkedOwner }: DeferredOwnerProps) => {
    const [state, setState] = React.useState<DeferredState>({ input: 1, epoch: 0 });
    setters.set(checkedOwner, setState);
    return jsx(React.Suspense, {
      fallback: jsx("b", { children: "fallback" }),
      children: jsx(
        Shell,
        { owner: checkedOwner, input: state.input, epoch: state.epoch },
        String(state.epoch),
      ),
    });
  };
  const getKind = (fiber: Fiber): string | null =>
    fiber.type === Shell
      ? "shell"
      : fiber.type === Content
        ? "content"
        : fiber.type === RowBody && typeof fiber.memoizedProps.kind === "string"
          ? fiber.memoizedProps.kind
          : fiber.type === "span"
            ? `${fiber.memoizedProps["data-kind"]}-host`
            : null;
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
      record(
        `commit:${checkedOwner}:${containers[checkedOwner].textContent}:${_fiberRoots.has(root)}`,
      );
      traverseRenderedFibers(checkedOwner === 0 ? root.current : root, (fiber, phase) => {
        const kind = getKind(fiber);
        if (kind) record(`phase:${checkedOwner}:${kind}:${phase}`);
      });
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      const kind = getKind(fiber);
      if (!kind) return;
      const isHost = fiber.type === "span";
      const checkedOwner = isHost ? fiber.memoizedProps["data-owner"] : fiber.memoizedProps.owner;
      const epoch = isHost ? fiber.memoizedProps["data-epoch"] : fiber.memoizedProps.epoch;
      const identity = identities.get(
        `${checkedOwner}:${epoch}:${isHost ? fiber.memoizedProps["data-kind"] : kind}`,
      );
      if (!identity) return;
      record(
        `delete:${checkedOwner}:${epoch}:${kind}:${getFiberById(isHost ? identity.hostIdentifier : identity.identifier) === fiber}`,
      );
      throw observerFailure;
    },
  });
  const renderInitial = async (checkedOwner: number): Promise<void> => {
    await React.act(async () => {
      const render = () => {
        const internals = Reflect.get(
          React,
          "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
        );
        expect(Reflect.get(internals, "T") !== null).toBe(
          checkedOwner === owner && initialTransition,
        );
        roots[checkedOwner].render(jsx(App, { owner: checkedOwner }));
      };
      if (checkedOwner === owner && initialTransition) React.startTransition(render);
      else render();
    });
  };
  const update = async (input: number, epoch: number, transition = false): Promise<void> => {
    const setter = setters.get(owner);
    if (!setter) throw new Error("Missing deferred setter");
    await React.act(async () => {
      if (transition) React.startTransition(() => setter({ input, epoch }));
      else setter({ input, epoch });
    });
  };
  const settle = async (value: number): Promise<void> => {
    const gate = gates.get(value);
    if (!gate) throw new Error("Missing deferred gate");
    expect(gate.settled).toBe(false);
    gate.ready = true;
    await React.act(async () => gate.resolve());
    expect(gate.settled).toBe(true);
  };
  const checkTrace = (expected: string[]): void => {
    expect(trace.splice(0)).toEqual(expected);
  };
  const report = "report:Bippy instrumentation encountered an error::true";
  const commit = (
    checkedOwner: number,
    epoch: number,
    input: number,
    kind: string,
    value: number,
    phases: string[],
  ): string[] => [
    `commit:${checkedOwner}:${checkedOwner}:${epoch}:${input}|${kind}:${value}:true`,
    ...phases.map((phase) => `phase:${checkedOwner}:${phase}`),
  ];
  const rowMount = (checkedOwner: number, epoch: number, kind: string, value: number): string[] => [
    `ref-on:${checkedOwner}:${epoch}:${kind}`,
    `row-on:${checkedOwner}:${epoch}:${kind}:${value}:true`,
  ];
  const rowDelete = (
    checkedOwner: number,
    epoch: number,
    kind: string,
    value: number,
  ): string[] => [
    `delete:${checkedOwner}:${epoch}:${kind}:true`,
    report,
    `row-off:${checkedOwner}:${epoch}:${kind}:${value}:false`,
    `delete:${checkedOwner}:${epoch}:${kind}-host:true`,
    report,
    `ref-off:${checkedOwner}:${epoch}:${kind}:false`,
  ];
  const preview = (checkedOwner: number, epoch: number, input: number): string[] => [
    ...rowMount(checkedOwner, epoch, "preview", input),
    ...commit(checkedOwner, epoch, input, "preview", input, [
      "shell:mount",
      "preview:mount",
      "preview-host:mount",
    ]),
    `passive-on:${checkedOwner}:${epoch}:preview:${input}:true`,
  ];
  const reveal = (checkedOwner: number, epoch: number, input: number): string[] => [
    ...rowDelete(checkedOwner, epoch, "preview", input),
    ...rowMount(checkedOwner, epoch, "leaf", input),
    `content-on:${checkedOwner}:${epoch}:content:${input}/${input}:${input}/${input}`,
    ...commit(checkedOwner, epoch, input, "leaf", input, [
      "shell:update",
      "content:mount",
      "leaf:mount",
      "leaf-host:mount",
    ]),
    `passive-off:${checkedOwner}:${epoch}:preview:${input}:false`,
    `passive-on:${checkedOwner}:${epoch}:leaf:${input}:true`,
  ];
  const urgent = (epoch: number, previous: number, input: number): string[] => [
    `content-off:${owner}:${epoch}:content:${previous}/${previous}:${previous}/${previous}`,
    `content-on:${owner}:${epoch}:content:${input}/${previous}:${input}/${previous}`,
    ...commit(owner, epoch, input, "leaf", previous, ["shell:update", "content:update"]),
  ];
  const complete = (
    epoch: number,
    previousInput: number,
    previous: number,
    input: number,
    hasShellPhase: boolean,
    checkedOwner = owner,
  ): string[] => [
    `row-off:${checkedOwner}:${epoch}:leaf:${previous}:true`,
    `content-off:${checkedOwner}:${epoch}:content:${previousInput}/${previous}:${previousInput}/${previous}`,
    `row-on:${checkedOwner}:${epoch}:leaf:${input}:true`,
    `content-on:${checkedOwner}:${epoch}:content:${input}/${input}:${input}/${input}`,
    ...commit(checkedOwner, epoch, input, "leaf", input, [
      ...(hasShellPhase ? ["shell:update"] : []),
      "content:update",
      "leaf:update",
      "leaf-host:update",
    ]),
    `passive-off:${checkedOwner}:${epoch}:leaf:${previous}:true`,
    `passive-on:${checkedOwner}:${epoch}:leaf:${input}:true`,
  ];
  const deleteContent = (
    checkedOwner: number,
    epoch: number,
    input: number,
    value: number,
  ): string[] => [
    `delete:${checkedOwner}:${epoch}:shell:true`,
    report,
    `delete:${checkedOwner}:${epoch}:content:true`,
    report,
    `content-off:${checkedOwner}:${epoch}:content:${input}/${value}:none`,
    ...rowDelete(checkedOwner, epoch, "leaf", value),
  ];
  const find = (checkedOwner: number, kind: string): Fiber => {
    const fiber = getFiberPreorder(getRoot(checkedOwner).current).find(
      (candidate) => getKind(candidate) === kind,
    );
    if (!fiber) throw new Error(`Missing committed deferred ${kind}`);
    return fiber;
  };
  const checkIdentity = (checkedOwner: number, epoch: number, kind: string): DeferredIdentity => {
    const identity = getIdentity(`${checkedOwner}:${epoch}:${kind}`);
    const fiber = find(checkedOwner, kind);
    expect(getFiberById(identity.identifier)).toBe(fiber);
    expect(getLatestFiber(identity.fiber)).toBe(fiber);
    if (fiber.alternate) expect(getLatestFiber(fiber.alternate)).toBe(fiber);
    if (identity.token) expect(fiber.memoizedState?.memoizedState).toBe(identity.token);
    if (identity.host) {
      expect(identity.host.isConnected).toBe(true);
      expect(getFiberById(identity.hostIdentifier)).toBe(fiber.child);
      const hostFiber = getFiber(identity.host);
      expect(hostFiber).not.toBeNull();
      if (hostFiber) expect(getLatestFiber(hostFiber)).toBe(fiber.child);
    }
    return identity;
  };
  const audit = (checkedOwner: number, epoch: number, input: number, value: number): void => {
    checkIdentity(checkedOwner, epoch, "shell");
    checkIdentity(checkedOwner, epoch, "content");
    checkIdentity(checkedOwner, epoch, "leaf");
    expect(find(checkedOwner, "shell").memoizedState?.memoizedState).toBe(true);
    expect(find(checkedOwner, "content").memoizedState?.next?.memoizedState).toBe(value);
    expect(find(checkedOwner, "content").memoizedProps.input).toBe(input);
    expect(containers[checkedOwner].textContent).toBe(
      `${checkedOwner}:${epoch}:${input}|leaf:${value}`,
    );
    expect(containers[checkedOwner].querySelector("b")).toBeNull();
    expect(attempts.some((attempt) => attempt.owner === owner && attempt.value === -1)).toBe(false);
  };
  const retire = (checkedOwner: number, epoch: number, kinds: string[]): void => {
    for (const kind of kinds) {
      const identity = getIdentity(`${checkedOwner}:${epoch}:${kind}`);
      expect(getFiberById(identity.identifier)).toBeNull();
      if (identity.host) {
        expect(getFiberById(identity.hostIdentifier)).toBeNull();
        expect(identity.host.isConnected).toBe(false);
      }
    }
  };
  try {
    await renderInitial(owner);
    checkTrace(preview(owner, 0, 1));
    expect(find(owner, "shell").memoizedState?.memoizedState).toBe(false);
    expect(blocked).toEqual(new Set([1]));
    const speculative = attempts.filter(
      (attempt) => attempt.owner === owner && attempt.kind === "leaf",
    );
    expect(speculative.length).toBeGreaterThan(0);
    expect(speculative.every((attempt) => attempt.value === 1)).toBe(true);
    expect(identities.has(`${owner}:0:content`)).toBe(false);
    expect(identities.has(`${owner}:0:leaf`)).toBe(false);
    checkIdentity(owner, 0, "preview");
    await renderInitial(1 - owner);
    checkTrace([
      ...rowMount(1 - owner, 0, "leaf", -1),
      `content-on:${1 - owner}:0:content:1/-1:1/-1`,
      ...commit(1 - owner, 0, 1, "leaf", -1, [
        "shell:mount",
        "content:mount",
        "leaf:mount",
        "leaf-host:mount",
      ]),
      `passive-on:${1 - owner}:0:leaf:-1:true`,
      ...complete(0, 1, -1, 1, false, 1 - owner),
    ]);
    audit(1 - owner, 0, 1, 1);
    await settle(1);
    checkTrace(reveal(owner, 0, 1));
    retire(owner, 0, ["preview"]);
    const original = checkIdentity(owner, 0, "leaf");
    expect(speculative.some((attempt) => attempt.token === original.token)).toBe(false);
    audit(owner, 0, 1, 1);
    await update(2, 0);
    checkTrace(urgent(0, 1, 2));
    audit(owner, 0, 2, 1);
    expect(blocked).toEqual(new Set([1, 2]));
    const pending = attempts.findLast(
      (attempt) => attempt.owner === owner && attempt.kind === "leaf" && attempt.value === 2,
    );
    if (!pending) throw new Error("Missing suspended deferred update");
    expect(pending.token).toBe(original.token);
    expect(getLatestFiber(pending.fiber)).toBe(find(owner, "leaf"));
    if (completes) {
      await settle(2);
      checkTrace(complete(0, 2, 1, 2, false));
      audit(owner, 0, 2, 2);
    }
    const previous = completes ? 2 : 1;
    await update(3, 1);
    checkTrace([
      ...deleteContent(owner, 0, 2, previous),
      ...rowMount(owner, 1, "preview", 3),
      ...commit(owner, 1, 3, "preview", 3, ["shell:mount", "preview:mount", "preview-host:mount"]),
      `passive-off:${owner}:0:leaf:${previous}:false`,
      `passive-on:${owner}:1:preview:3:true`,
      ...reveal(owner, 1, 3),
    ]);
    retire(owner, 0, ["shell", "content", "leaf"]);
    retire(owner, 1, ["preview"]);
    audit(owner, 1, 3, 3);
    const remount = checkIdentity(owner, 1, "leaf");
    expect(remount.token).not.toBe(original.token);
    expect(remount.host).not.toBe(original.host);
    const beforeLate = attempts.length;
    if (!completes) await settle(2);
    expect(gates.get(2)?.settled).toBe(true);
    checkTrace([]);
    expect(attempts.length).toBe(beforeLate);
    await update(4, 1, true);
    checkTrace(complete(1, 3, 3, 4, true));
    audit(owner, 1, 4, 4);
    expect(checkIdentity(owner, 1, "leaf")).toBe(remount);
    await update(5, 1);
    checkTrace(urgent(1, 4, 5));
    audit(owner, 1, 5, 4);
    expect(blocked).toEqual(new Set([1, 2, 5]));
    await React.act(async () => roots[owner].render(null));
    checkTrace([
      ...deleteContent(owner, 1, 5, 4),
      `commit:${owner}::false`,
      `passive-off:${owner}:1:leaf:4:false`,
    ]);
    retire(owner, 1, ["shell", "content", "leaf"]);
    const beforeDeletedSettlement = attempts.length;
    await settle(5);
    expect(gates.get(5)?.settled).toBe(true);
    checkTrace([]);
    expect(attempts.length).toBe(beforeDeletedSettlement);
    audit(1 - owner, 0, 1, 1);
    await React.act(async () => roots[1 - owner].render(null));
    checkTrace([
      ...deleteContent(1 - owner, 0, 1, 1),
      `commit:${1 - owner}::false`,
      `passive-off:${1 - owner}:0:leaf:1:false`,
    ]);
    retire(1 - owner, 0, ["shell", "content", "leaf"]);
    return [...transcript];
  } finally {
    unsubscribe();
    try {
      for (const gate of gates.values()) {
        gate.ready = true;
        gate.resolve();
      }
      await React.act(async () => {
        await Promise.all([...gates.values()].map((gate) => gate.promise));
      });
      for (const root of roots) await React.act(async () => root.unmount());
      expect(subscriptions.size).toBe(0);
      for (const root of committedRoots.values()) expect(_fiberRoots.has(root)).toBe(false);
      for (const identity of identities.values()) {
        expect(getFiberById(identity.identifier)).toBeNull();
        if (identity.host) expect(getFiberById(identity.hostIdentifier)).toBeNull();
      }
    } finally {
      for (const container of containers) container.remove();
    }
  }
};

it.each(
  [0, 1].flatMap((owner) =>
    [false, true].flatMap((initialTransition) =>
      [false, true].map((completes) => ({ owner, initialTransition, completes })),
    ),
  ),
)(
  "replays deferred values, owner $owner, initial transition $initialTransition, completes $completes",
  async (options) => {
    expect(await runDeferredValues(options)).toEqual(await runDeferredValues(options));
  },
);
