import {
  _fiberRoots,
  getRDTHook,
  instrument,
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

const runCommitReadiness = (isReplacement: boolean): string[] => {
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
    if (isReplacement) target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = createForeignHook(trace);
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
