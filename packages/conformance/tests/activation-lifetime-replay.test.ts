import {
  getRDTHook,
  instrument,
  type InstrumentationOptions,
  type ReactDevToolsGlobalHook,
  type ReactDevToolsTarget,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";

interface ActivationScenario {
  name: string;
  cancellations: number;
  doesMutateOptions: boolean;
  doesReplaceHook: boolean;
}

const scenarios: ActivationScenario[] = [
  {
    name: "duplicate callbacks",
    cancellations: 0,
    doesMutateOptions: false,
    doesReplaceHook: false,
  },
  {
    name: "one canceled duplicate",
    cancellations: 1,
    doesMutateOptions: false,
    doesReplaceHook: false,
  },
  {
    name: "two canceled duplicates",
    cancellations: 2,
    doesMutateOptions: false,
    doesReplaceHook: false,
  },
  {
    name: "mutated registration options",
    cancellations: 3,
    doesMutateOptions: true,
    doesReplaceHook: false,
  },
  {
    name: "replacement after disposal",
    cancellations: 3,
    doesMutateOptions: false,
    doesReplaceHook: true,
  },
  {
    name: "surviving duplicate callbacks after replacement",
    cancellations: 1,
    doesMutateOptions: false,
    doesReplaceHook: true,
  },
];

const runActivationLifetime = (scenario: ActivationScenario): string[] => {
  const target: ReactDevToolsTarget = {};
  const trace: string[] = [];
  const onActive = new Proxy(
    () => {
      trace.push("active");
    },
    {
      apply: (callback, receiver, argumentsList) => {
        trace.push(`receiver:${receiver === undefined}:${argumentsList.length}`);
        return Reflect.apply(callback, receiver, argumentsList);
      },
    },
  );
  const options: InstrumentationOptions = { target, onActive };
  const subscriptions = Array.from({ length: 3 }, () => instrument(options));
  const hook = getRDTHook(undefined, target);
  expect(trace).toEqual([]);
  try {
    if (scenario.doesMutateOptions)
      options.onActive = () => {
        trace.push("replacement-callback");
      };
    for (const unsubscribe of subscriptions.slice(0, scenario.cancellations)) {
      unsubscribe();
      unsubscribe[Symbol.dispose]();
    }
    hook.inject({ rendererPackageName: "activation-fixture", version: "19.3.0", bundleType: 1 });
    const expected = Array.from({ length: 3 - scenario.cancellations }, () => [
      "receiver:true:0",
      "active",
    ]).flat();
    expect(trace, scenario.name).toEqual(expected);
    if (scenario.doesReplaceHook) {
      const perActivation = [...expected];
      for (let replacementIndex = 0; replacementIndex < 3; replacementIndex++) {
        const current = getRDTHook(undefined, target);
        const replacement: ReactDevToolsGlobalHook = {
          ...current,
          _instrumentationSource: undefined,
          _instrumentationIsActive: false,
          renderers: new Map(),
        };
        target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = replacement;
        expect(getRDTHook(undefined, target) === replacement).toBe(true);
        expect(replacement.renderers.size).toBe(1);
        expected.push(...perActivation);
        expect(trace, `${scenario.name}: replacement ${replacementIndex}`).toEqual(expected);
      }
    }
  } finally {
    for (const unsubscribe of subscriptions) unsubscribe();
  }
  return trace;
};

it.each(scenarios)("replays independent activation lifetimes: $name", (scenario) => {
  expect(runActivationLifetime(scenario)).toEqual(runActivationLifetime(scenario));
});

const runReentrantActivation = (shouldDisposeChild: boolean): string[] => {
  const target: ReactDevToolsTarget = {};
  const trace: string[] = [];
  const failure = new Error("nested activation failed");
  const childSubscriptions: Array<() => void> = [];
  let didRegisterChild = false;
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      trace.push(`report:${message}:${error === failure}`);
      throw new Error("activation reporter failed");
    });
  using _parent = instrument({
    target,
    onActive: () => {
      trace.push("parent-enter");
      if (!didRegisterChild) {
        didRegisterChild = true;
        const child = instrument({
          target,
          onActive: () => {
            trace.push("child");
            tail();
            throw failure;
          },
        });
        childSubscriptions.push(child);
        if (shouldDisposeChild) child();
      }
      trace.push("parent-exit");
    },
  });
  using tail = instrument({
    target,
    onActive: () => {
      trace.push("removed-tail");
    },
  });
  try {
    const hook = getRDTHook(undefined, target);
    hook.inject({ rendererPackageName: "reentrant-activation", version: "19.3.0", bundleType: 1 });
    const expected = [
      "parent-enter",
      "child",
      "report:Bippy instrumentation encountered an error::true",
      "parent-exit",
    ];
    expect(trace).toEqual(expected);
    target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      ...hook,
      _instrumentationSource: undefined,
      _instrumentationIsActive: false,
      renderers: new Map(),
    };
    expect(trace).toEqual([
      ...expected,
      "parent-enter",
      "parent-exit",
      ...(shouldDisposeChild
        ? []
        : ["child", "report:Bippy instrumentation encountered an error::true"]),
    ]);
  } finally {
    for (const unsubscribe of childSubscriptions) unsubscribe();
  }
  return trace;
};

it.each([false, true])(
  "delivers reentrant activation once and honors in-dispatch disposal, dispose child: %s",
  (shouldDisposeChild) => {
    expect(runReentrantActivation(shouldDisposeChild)).toEqual(
      runReentrantActivation(shouldDisposeChild),
    );
  },
);
