// Browser adaptation of the test scaffolding used by facebook/react's
// packages/react-refresh/src/__tests__/ReactFresh-test.js (MIT licensed,
// Copyright (c) Meta Platforms, Inc. and affiliates). Instead of jest +
// jsdom, scenarios run against a real react-dom root in a real browser
// with bippy instrumentation active, which is the environment bippy
// actually has to survive in.
import * as bippy from "bippy";
import * as React from "react";
import { createRoot, type Root, type RootOptions } from "react-dom/client";
// Kept for React 17, whose act lives here; on 18/19 the react export wins.
import * as ReactDOMTestUtils from "react-dom/test-utils";
import ReactFreshRuntime from "react-refresh/runtime";

import { expect } from "./expect-lite";

window.IS_REACT_ACT_ENVIRONMENT = true;

interface ActImplementation {
  (scope: () => void | Promise<void>): void | Promise<void>;
}

interface ModuleWithAct {
  act?: ActImplementation;
  unstable_act?: ActImplementation;
}

const reactModuleWithAct: ModuleWithAct = React;
const testUtilsWithAct: ModuleWithAct = ReactDOMTestUtils;
const reactAct = reactModuleWithAct.act ?? reactModuleWithAct.unstable_act ?? testUtilsWithAct.act;

const flushWithoutAct = async (scope: () => void | Promise<void>): Promise<void> => {
  await scope();
  await new Promise((resolveSleep) => setTimeout(resolveSleep, 50));
};

export const act = async (scope: () => void | Promise<void>): Promise<void> => {
  if (reactAct) {
    // Always hand act an async scope: React 17's act only flushes
    // microtasks (e.g. resolved lazy thenables) for async scopes.
    await reactAct(async () => {
      await scope();
    });
    return;
  }
  await flushWithoutAct(scope);
};

export interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (reason: Error) => void;
}

export const createDeferred = <Value,>(): Deferred<Value> => {
  let resolve!: (value: Value) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Value>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
};

export const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, durationMs));

export interface HarnessTools {
  React: typeof React;
  ReactFreshRuntime: typeof ReactFreshRuntime;
  act: typeof act;
  container: HTMLDivElement;
  firstElement: () => HTMLElement;
  clickElement: (element: HTMLElement) => Promise<void>;
  createDeferred: typeof createDeferred;
  sleep: typeof sleep;
  expect: typeof expect;
  log: string[];
  assertLog: (expected: string[]) => void;
  render: <Props extends object>(
    version: () => React.ComponentType<Props>,
    props?: Props,
  ) => Promise<React.ComponentType<Props>>;
  renderElement: (element: React.ReactNode) => Promise<void>;
  patch: <Version>(version: () => Version) => Promise<Version>;
  patchSync: <Version>(version: () => Version) => Version;
  register: (type: unknown, id: string) => void;
  setSignature: (
    type: unknown,
    key: string,
    forceReset?: boolean,
    getCustomHooks?: () => unknown[],
  ) => void;
  unmountRoot: () => Promise<void>;
  createExtraRoot: (rootOptions?: RootOptions) => { container: HTMLDivElement; root: Root };
  expectBippyCommits: () => void;
  bippyCommitCount: () => number;
}

export interface Scenario {
  (tools: HarnessTools): Promise<void>;
}

let observedCommitCount = 0;
bippy.instrument({
  onCommitFiberRoot: () => {
    observedCommitCount++;
  },
});

const extraContainers: HTMLDivElement[] = [];
const extraRoots: Root[] = [];

export const createHarnessTools = (): HarnessTools => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const log: string[] = [];
  const commitCountAtStart = observedCommitCount;

  const render: HarnessTools["render"] = async (version, props) => {
    const Component = version();
    await act(() => {
      root.render(<Component {...(props ?? ({} as never))} />);
    });
    return Component;
  };

  return {
    React,
    ReactFreshRuntime,
    act,
    container,
    firstElement: () => {
      const element = container.firstChild;
      if (!(element instanceof HTMLElement)) {
        throw new Error("expected container.firstChild to be an HTMLElement");
      }
      return element;
    },
    clickElement: async (element) => {
      await act(() => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    },
    createDeferred,
    sleep,
    expect,
    log,
    assertLog: (expected) => {
      expect(log).toEqual(expected);
      log.length = 0;
    },
    render,
    renderElement: async (element) => {
      await act(() => {
        root.render(element);
      });
    },
    patch: async (version) => {
      const result = version();
      await act(() => {
        ReactFreshRuntime.performReactRefresh();
      });
      return result;
    },
    patchSync: (version) => {
      const result = version();
      ReactFreshRuntime.performReactRefresh();
      return result;
    },
    register: (type, id) => {
      ReactFreshRuntime.register(type, id);
    },
    setSignature: (type, key, forceReset, getCustomHooks) => {
      ReactFreshRuntime.setSignature(type, key, forceReset, getCustomHooks);
    },
    unmountRoot: async () => {
      await act(() => {
        root.unmount();
      });
    },
    createExtraRoot: (rootOptions) => {
      const extraContainer = document.createElement("div");
      document.body.appendChild(extraContainer);
      const extraRoot = createRoot(extraContainer, rootOptions);
      extraContainers.push(extraContainer);
      extraRoots.push(extraRoot);
      return { container: extraContainer, root: extraRoot };
    },
    expectBippyCommits: () => {
      if (observedCommitCount <= commitCountAtStart) {
        throw new Error(
          "bippy observed no onCommitFiberRoot dispatches while the scenario committed work",
        );
      }
    },
    bippyCommitCount: () => observedCommitCount,
  };
};
