import {
  _fiberRoots,
  getFiberById,
  getFiberId,
  getRenderer,
  getRDTHook,
  instrument,
  type Fiber,
  type FiberRoot,
  type ReactDevToolsGlobalHook,
  type ReactDevToolsTarget,
  type ReactRenderer,
} from "bippy";
import {
  onRDTHookReplace,
  onRendererInject,
  removeActiveListener,
} from "../../bippy/src/rdt-hook.js";
import { expect, it, vi } from "vite-plus/test";
import { createFiber } from "./fiber-fixture.js";

interface RetainedHookFixture {
  owner: number;
  root: FiberRoot;
  fiber: Fiber;
  identifier: number;
  renderer: ReactRenderer;
  hook: ReactDevToolsGlobalHook;
}

const createRenderer = (name: string): ReactRenderer => ({
  rendererPackageName: name,
  version: "19.3.0",
  bundleType: 1,
});

const createForeignHook = (trace: string[]): ReactDevToolsGlobalHook => {
  const target: ReactDevToolsTarget = {};
  const template = getRDTHook(undefined, target);
  const renderers = new Map([[100, createRenderer("existing")]]);
  let nextIdentifier = 100;
  return {
    ...template,
    _isBippyHook: false,
    _instrumentationSource: undefined,
    _instrumentationIsActive: false,
    renderers,
    inject: (renderer) => {
      const identifier = ++nextIdentifier;
      trace.push(`raw-inject:${renderer.rendererPackageName}:${identifier}`);
      renderers.set(identifier, renderer);
      return identifier;
    },
    onCommitFiberRoot: () => {
      trace.push("raw-commit");
    },
  };
};

const runInstallerCancellation = (): string[] => {
  const target: ReactDevToolsTarget = {};
  const trace: string[] = [];
  const onActive = (): void => {
    trace.push("installer-active");
  };
  getRDTHook(onActive, target);
  try {
    removeActiveListener(onActive, target);
    target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = createForeignHook(trace);
    expect([...trace]).toEqual([]);
    getRDTHook(onActive, target);
    expect([...trace]).toEqual(["installer-active"]);
    removeActiveListener(onActive, target);
    target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = createForeignHook(trace);
    expect([...trace]).toEqual(["installer-active"]);
  } finally {
    removeActiveListener(onActive, target);
  }
  return trace;
};

it("preserves direct installer cancellation across replacement and explicit reactivation", () => {
  expect(runInstallerCancellation()).toEqual(runInstallerCancellation());
});

const runCommitReadiness = (isReplacement: boolean, replacementMode = "setter"): string[] => {
  const target: ReactDevToolsTarget = {};
  const trace: string[] = [];
  const root: FiberRoot = {
    current: createFiber({ memoizedState: { element: {}, memoizedState: null, next: null } }),
  };
  const original = getRDTHook(undefined, target);
  const rendererIdentifier = isReplacement ? 100 : original.inject(createRenderer("existing"));
  const unsubscribe = instrument({
    target,
    onActive: () => {
      trace.push("active-enter");
      getRDTHook(undefined, target).onCommitFiberRoot(rendererIdentifier, root, undefined);
      trace.push("active-exit");
    },
    onCommitFiberRoot: (rendererId, committedRoot) => {
      trace.push(
        `commit:${rendererId === rendererIdentifier}:${committedRoot === root}:${_fiberRoots.has(root)}`,
      );
    },
  });
  try {
    if (isReplacement) {
      const replacement = createForeignHook(trace);
      if (replacementMode === "setter") {
        target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = replacement;
      } else {
        if (replacementMode === "writable") {
          Object.defineProperty(target, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
            configurable: false,
            writable: true,
            value: original,
          });
          target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = replacement;
        } else {
          Object.defineProperty(
            target,
            "__REACT_DEVTOOLS_GLOBAL_HOOK__",
            replacementMode === "getter"
              ? {
                  configurable: false,
                  get: () => replacement,
                }
              : {
                  configurable: true,
                  writable: true,
                  value: replacement,
                },
          );
        }
        using _rewire = instrument({ target });
      }
    }
    expect([...trace]).toEqual([
      "active-enter",
      ...(isReplacement ? ["raw-commit"] : []),
      "commit:true:true:true",
      "active-exit",
    ]);
    expect(_fiberRoots.has(root)).toBe(true);
  } finally {
    unsubscribe();
    root.current.memoizedState = { element: null, memoizedState: null, next: null };
    getRDTHook(undefined, target).onCommitFiberRoot(rendererIdentifier, root, undefined);
  }
  expect(_fiberRoots.has(root)).toBe(false);
  return trace;
};

it.each([false, true])(
  "is ready for commits triggered by activation, replacing hook: %s",
  (isReplacement) => {
    expect(runCommitReadiness(isReplacement)).toEqual(runCommitReadiness(isReplacement));
  },
);

it.each(["descriptor", "writable", "getter"])(
  "rewires before pending activation when replacement bypasses the setter through %s",
  (replacementMode) => {
    expect(runCommitReadiness(true, replacementMode)).toEqual(
      runCommitReadiness(true, replacementMode),
    );
  },
);

const runInjectionReadiness = (): string[] => {
  const target: ReactDevToolsTarget = {};
  const trace: string[] = [];
  const first = createRenderer("first");
  const second = createRenderer("second");
  const failure = new Error("inject observer failed");
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      trace.push(`report:${message}:${error === failure}`);
      throw new Error("inject reporter failed");
    });
  using _active = instrument({
    target,
    onActive: () => {
      trace.push("active-enter");
      const identifier = getRDTHook(undefined, target).inject(first);
      trace.push(`active-exit:${identifier}`);
    },
  });
  using _first = onRendererInject((renderer) => {
    trace.push(`first:${renderer.rendererPackageName}`);
    if (renderer === first) {
      const identifier = getRDTHook(undefined, target).inject(second);
      trace.push(`nested-return:${identifier}`);
    }
    throw failure;
  }, target);
  using _later = onRendererInject((renderer) => {
    trace.push(`later:${renderer.rendererPackageName}`);
  }, target);
  const replacement = createForeignHook(trace);
  target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = replacement;
  expect(trace).toEqual([
    "active-enter",
    "raw-inject:first:101",
    "first:first",
    "raw-inject:second:102",
    "first:second",
    "report:Bippy instrumentation encountered an error::true",
    "later:second",
    "nested-return:102",
    "report:Bippy instrumentation encountered an error::true",
    "later:first",
    "active-exit:101",
  ]);
  expect(replacement.renderers.get(101) === first).toBe(true);
  expect(replacement.renderers.get(102) === second).toBe(true);
  expect(replacement.renderers.size).toBe(3);
  const checkpoint = trace.length;
  expect(replacement.inject(first)).toBe(103);
  expect(trace.slice(checkpoint)).toEqual(["raw-inject:first:103"]);
  expect(replacement.renderers.get(103) === first).toBe(true);
  return trace;
};

it("tracks nested injection during replacement activation exactly once despite observer failures", () => {
  expect(runInjectionReadiness()).toEqual(runInjectionReadiness());
});

const runReplacementObserver = (): string[] => {
  const target: ReactDevToolsTarget = {};
  const trace: string[] = [];
  const root: FiberRoot = {
    current: createFiber({ memoizedState: { element: {}, memoizedState: null, next: null } }),
  };
  const childSubscriptions: Array<() => void> = [];
  using parent = instrument({
    target,
    onActive: () => {
      trace.push("parent-active");
    },
    onCommitFiberRoot: () => {
      trace.push(`parent-commit:${_fiberRoots.has(root)}`);
    },
  });
  using _injection = onRendererInject((renderer) => {
    trace.push(`injected:${renderer.rendererPackageName}`);
  }, target);
  using _replacement = onRDTHookReplace((hook, replacedTarget) => {
    if (replacedTarget !== target) return;
    trace.push(
      `ready:${hook === target.__REACT_DEVTOOLS_GLOBAL_HOOK__}:${hook._instrumentationIsActive}`,
    );
    hook.inject(createRenderer("from-replacement"));
    const child = instrument({
      target,
      onActive: () => {
        trace.push("child-active");
        hook.onCommitFiberRoot(101, root, undefined);
      },
      onCommitFiberRoot: () => {
        trace.push("child-commit");
      },
    });
    childSubscriptions.push(child);
    trace.push("ready-exit");
  });
  try {
    target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = createForeignHook(trace);
    expect([...trace]).toEqual([
      "ready:true:true",
      "raw-inject:from-replacement:101",
      "injected:from-replacement",
      "child-active",
      "raw-commit",
      "parent-commit:true",
      "child-commit",
      "ready-exit",
      "parent-active",
    ]);
    expect(_fiberRoots.has(root)).toBe(true);
  } finally {
    parent();
    for (const unsubscribe of childSubscriptions) unsubscribe();
    root.current.memoizedState = { element: null, memoizedState: null, next: null };
    getRDTHook(undefined, target).onCommitFiberRoot(101, root, undefined);
  }
  expect(_fiberRoots.has(root)).toBe(false);
  return trace;
};

it("prepares injection and commit dispatch before replacement observers and does not reactivate their new subscriptions twice", () => {
  expect(runReplacementObserver()).toEqual(runReplacementObserver());
});

const runRetainedHooks = (deletionOrder: number[]): string[] => {
  const target: ReactDevToolsTarget = {};
  const trace: string[] = [];
  const owners = [0, 1, 2];
  const liveOwners = new Set(owners);
  const hookFailure = new Error("retained hook failed");
  const observerFailure = new Error("retained observer failed");
  const fixtures: RetainedHookFixture[] = owners.map((owner) => {
    const root: FiberRoot = {
      current: createFiber({
        tag: 3,
        memoizedState: { element: {}, memoizedState: null, next: null },
      }),
    };
    root.current.stateNode = root;
    const fiber = createFiber({ return: root.current, key: `probe-${owner}` });
    root.current.child = fiber;
    const renderer = createRenderer(`renderer-${owner}`);
    const hook = createForeignHook(trace);
    hook.renderers.set(100, renderer);
    hook.onCommitFiberRoot = () => {
      trace.push(`raw-commit:${owner}`);
    };
    hook.onPostCommitFiberRoot = () => {
      trace.push(`raw-post:${owner}`);
      throw hookFailure;
    };
    hook.onCommitFiberUnmount = () => {
      trace.push(`raw-delete:${owner}`);
      throw hookFailure;
    };
    return { owner, root, fiber, identifier: getFiberId(fiber), renderer, hook };
  });
  const getFixture = (root: FiberRoot): RetainedHookFixture => {
    const fixture = fixtures.find((candidate) => candidate.root === root);
    if (!fixture) throw new Error("Unknown committed root");
    return fixture;
  };
  const getDeletedFixture = (fiber: Fiber): RetainedHookFixture => {
    const fixture = fixtures.find((candidate) => candidate.fiber === fiber);
    if (!fixture) throw new Error("Unknown deleted fiber");
    return fixture;
  };
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((_message: unknown, error: unknown) => {
      trace.push(
        `report:${error === hookFailure ? "hook" : error === observerFailure ? "observer" : "unknown"}`,
      );
      throw new Error("retained reporter failed");
    });
  let activationIndex = 0;
  using observer = instrument({
    target,
    onActive: () => {
      const fixture = fixtures[activationIndex++];
      trace.push(`enter:${fixture.owner}`);
      fixture.hook.onCommitFiberRoot(100, fixture.root, undefined);
      const next = fixtures[activationIndex];
      if (next) {
        target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = next.hook;
        using _rewire = instrument({ target });
      }
      fixture.hook.onPostCommitFiberRoot?.(100, fixture.root);
      trace.push(`exit:${fixture.owner}`);
    },
    onCommitFiberRoot: (_rendererId, root) => {
      const fixture = getFixture(root);
      const isLive = liveOwners.has(fixture.owner);
      trace.push(
        `commit:${fixture.owner}:${_fiberRoots.has(root)}:${getRenderer(fixture.fiber, target) === (isLive ? fixture.renderer : null)}`,
      );
    },
    onPostCommitFiberRoot: (_rendererId, root) => {
      const fixture = getFixture(root);
      trace.push(
        `post:${fixture.owner}:${getRenderer(fixture.fiber, target) === fixture.renderer}:${_fiberRoots.has(root)}`,
      );
      throw observerFailure;
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      const fixture = getDeletedFixture(fiber);
      trace.push(`delete:${fixture.owner}:${getFiberById(fixture.identifier) === fiber}`);
      throw observerFailure;
    },
  });
  using later = instrument({
    target,
    onCommitFiberRoot: (_rendererId, root) => {
      trace.push(`later-commit:${getFixture(root).owner}:${_fiberRoots.has(root)}`);
    },
    onPostCommitFiberRoot: (_rendererId, root) => {
      trace.push(`later-post:${getFixture(root).owner}`);
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      const fixture = getDeletedFixture(fiber);
      trace.push(`later-delete:${fixture.owner}:${getFiberById(fixture.identifier) === fiber}`);
    },
  });
  try {
    Object.defineProperty(target, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      configurable: false,
      writable: true,
      value: fixtures[0].hook,
    });
    using _rewire = instrument({ target });
    expect(activationIndex).toBe(3);
    const expected = [
      ...owners.flatMap((owner) => [
        `enter:${owner}`,
        `raw-commit:${owner}`,
        `commit:${owner}:true:true`,
        `later-commit:${owner}:true`,
      ]),
      ...[2, 1, 0].flatMap((owner) => [
        `raw-post:${owner}`,
        "report:hook",
        `post:${owner}:true:true`,
        "report:observer",
        `later-post:${owner}`,
        `exit:${owner}`,
      ]),
    ];
    expect([...trace]).toEqual(expected);
    expect(target.__REACT_DEVTOOLS_GLOBAL_HOOK__ === fixtures[2].hook).toBe(true);
    for (const owner of deletionOrder) {
      const fixture = fixtures[owner];
      fixture.hook.onCommitFiberUnmount(100, fixture.fiber);
      trace.push(`released:${owner}:${getFiberById(fixture.identifier) === null}`);
      liveOwners.delete(owner);
      fixture.root.current.child = null;
      fixture.root.current.memoizedState = { element: null, memoizedState: null, next: null };
      fixture.hook.onCommitFiberRoot(100, fixture.root, undefined);
      expected.push(
        `raw-delete:${owner}`,
        "report:hook",
        `delete:${owner}:true`,
        "report:observer",
        `later-delete:${owner}:true`,
        `released:${owner}:true`,
        `raw-commit:${owner}`,
        `commit:${owner}:false:true`,
        `later-commit:${owner}:false`,
      );
      expect([...trace]).toEqual(expected);
      for (const candidate of fixtures) {
        const isLive = liveOwners.has(candidate.owner);
        expect(_fiberRoots.has(candidate.root)).toBe(isLive);
        expect(getRenderer(candidate.fiber, target) === (isLive ? candidate.renderer : null)).toBe(
          true,
        );
        expect(getFiberById(candidate.identifier) === (isLive ? candidate.fiber : null)).toBe(true);
      }
    }
  } finally {
    observer();
    later();
    const currentHook = getRDTHook(undefined, target);
    for (const owner of liveOwners) {
      const fixture = fixtures[owner];
      currentHook.onCommitFiberUnmount(100, fixture.fiber);
      fixture.root.current.child = null;
      fixture.root.current.memoizedState = { element: null, memoizedState: null, next: null };
      currentHook.onCommitFiberRoot(100, fixture.root, undefined);
    }
  }
  return trace;
};

it.each([
  { order: [0, 1, 2] },
  { order: [0, 2, 1] },
  { order: [1, 0, 2] },
  { order: [1, 2, 0] },
  { order: [2, 0, 1] },
  { order: [2, 1, 0] },
])(
  "retains renderer ownership through nested activation and throwing old hooks, deletion order $order",
  ({ order }) => {
    expect(runRetainedHooks(order)).toEqual(runRetainedHooks(order));
  },
);
