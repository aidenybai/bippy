import "../src/index.js"; // KEEP THIS LINE ON TOP

import { describe, expect, it } from "vitest";
import type { Fiber } from "../src/types.js";
import { instrument } from "../src/index.js";
import { getFiberHooks, type HooksNode } from "../src/source/inspect-hooks.js";
import React from "react";
import { useFormStatus } from "react-dom";
import { render } from "@testing-library/react";

const StateComponent = () => {
  const [count, _setCount] = React.useState(0);
  const [label, _setLabel] = React.useState("hello");
  return (
    <div>
      {count} {label}
    </div>
  );
};

const RefComponent = () => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return <input ref={inputRef} />;
};

const ReducerComponent = () => {
  const [state, _dispatch] = React.useReducer(
    (previous: number, action: number) => previous + action,
    10,
  );
  return <div>{state}</div>;
};

const MultiHookComponent = () => {
  const [count, _setCount] = React.useState(0);
  const ref = React.useRef(null);
  React.useEffect(() => {}, []);
  const memoized = React.useMemo(() => count * 2, [count]);
  return <div ref={ref}>{memoized}</div>;
};

const useCounter = (initialValue: number) => {
  const [count, setCount] = React.useState(initialValue);
  const increment = React.useCallback(() => setCount((previous: number) => previous + 1), []);
  return { count, increment };
};

const CustomHookComponent = () => {
  const { count } = useCounter(5);
  return <div>{count}</div>;
};

const TransitionComponent = () => {
  const [isPending, _startTransition] = React.useTransition();
  return <div>{String(isPending)}</div>;
};

const IdComponent = () => {
  const identifier = React.useId();
  return <div id={identifier} />;
};

const ForwardRefComponent = React.forwardRef<HTMLDivElement, { label: string }>((props, ref) => {
  const [count, _setCount] = React.useState(0);
  return (
    <div ref={ref}>
      {props.label} {count}
    </div>
  );
});
ForwardRefComponent.displayName = "ForwardRefComponent";

const MemoComponent = React.memo(() => {
  const [value, _setValue] = React.useState("memoized");
  return <div>{value}</div>;
});
MemoComponent.displayName = "MemoComponent";

const captureFiber = (callback: (fiber: Fiber) => void) => {
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      callback(fiberRoot.current.child);
    },
  });
};

const collectAllHooks = (hooks: HooksNode[]): HooksNode[] => {
  const allHooks: HooksNode[] = [];
  const walk = (nodes: HooksNode[]) => {
    for (const node of nodes) {
      allHooks.push(node);
      if (node.subHooks.length > 0) walk(node.subHooks);
    }
  };
  walk(hooks);
  return allHooks;
};

describe("getFiberHooks", () => {
  it("returns a non-empty hooks tree for a stateful component", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<StateComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    expect(allHooks.length).toBeGreaterThanOrEqual(2);

    const hookValues = allHooks.map((hook) => hook.value);
    expect(hookValues).toContain(0);
    expect(hookValues).toContain("hello");
  });

  it("returns hook values for useRef", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<RefComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    expect(allHooks.length).toBeGreaterThanOrEqual(1);
  });

  it("returns hook values for useReducer", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<ReducerComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const hookValues = allHooks.map((hook) => hook.value);
    expect(hookValues).toContain(10);
  });

  it("inspects multiple hook types in one component", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<MultiHookComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    expect(allHooks.length).toBeGreaterThanOrEqual(4);

    const hookValues = allHooks.map((hook) => hook.value);
    expect(hookValues).toContain(0);
    expect(hookValues).toContain(0);
  });

  it("inspects custom hooks", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<CustomHookComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    expect(allHooks.length).toBeGreaterThanOrEqual(1);

    const hookValues = allHooks.map((hook) => hook.value);
    expect(hookValues).toContain(5);
  });

  it("inspects useTransition", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<TransitionComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const hookValues = allHooks.map((hook) => hook.value);
    expect(hookValues).toContain(false);
  });

  it("inspects useId", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<IdComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const stringValues = allHooks.filter((hook) => typeof hook.value === "string");
    expect(stringValues.length).toBeGreaterThanOrEqual(1);
    expect((stringValues[0].value as string).length).toBeGreaterThan(0);
  });

  it("inspects ForwardRef components", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<ForwardRefComponent label="test" />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const hookValues = allHooks.map((hook) => hook.value);
    expect(hookValues).toContain(0);
  });

  it("inspects React.memo components", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<MemoComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const hookValues = allHooks.map((hook) => hook.value);
    expect(hookValues).toContain("memoized");
  });

  it("throws for non-function-component fibers", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode?.child;
    });
    render(<StateComponent />);

    expect(() => getFiberHooks(fiber!)).toThrow(
      "Unknown Fiber. Needs to be a function component to inspect hooks.",
    );
  });

  it("assigns sequential numeric IDs to stateful hooks", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<MultiHookComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const idsWithValues = allHooks.filter((hook) => hook.id !== null).map((hook) => hook.id);
    for (let hookIndex = 0; hookIndex < idsWithValues.length; hookIndex++) {
      expect(idsWithValues[hookIndex]).toBe(hookIndex);
    }
  });

  it("marks stateful hooks as state-editable", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<StateComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const editableHooks = allHooks.filter((hook) => hook.isStateEditable);
    expect(editableHooks.length).toBeGreaterThanOrEqual(1);
  });

  it("provides hookSource on nodes", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<StateComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    for (const hook of allHooks) {
      expect(hook).toHaveProperty("hookSource");
    }
  });
});

const ThemeContext = React.createContext("light");
ThemeContext.displayName = "ThemeContext";

const ContextComponent = () => {
  const theme = React.useContext(ThemeContext);
  return <div>{theme}</div>;
};

const externalStore = {
  value: "store-value",
  subscribe: () => () => {},
  getSnapshot: () => externalStore.value,
};

const SyncExternalStoreComponent = () => {
  const snapshot = React.useSyncExternalStore(externalStore.subscribe, externalStore.getSnapshot);
  return <div>{snapshot}</div>;
};

const DeferredValueComponent = () => {
  const deferredLabel = React.useDeferredValue("deferred-label");
  return <div>{deferredLabel}</div>;
};

const OptimisticComponent = () => {
  const [optimisticCount] = React.useOptimistic(7);
  return <div>{optimisticCount}</div>;
};

const ActionStateComponent = () => {
  const [formState] = React.useActionState((previous: string) => previous, "action-initial");
  return <div>{formState}</div>;
};

const FormStatusComponent = () => {
  const status = useFormStatus();
  return <div>{String(status.pending)}</div>;
};

const ImperativeHandleComponent = React.forwardRef<{ focus: () => void }>((_props, ref) => {
  React.useImperativeHandle(ref, () => ({ focus: () => {} }));
  return <div />;
});
ImperativeHandleComponent.displayName = "ImperativeHandleComponent";

const useStatusWithDebugValue = () => {
  const [status] = React.useState("online");
  React.useDebugValue(status);
  return status;
};

const useStatusWithFormatter = () => {
  const [status] = React.useState("online");
  React.useDebugValue(status, (value) => `formatted:${value}`);
  return status;
};

const useStatusWithManyDebugValues = () => {
  const [status] = React.useState("online");
  React.useDebugValue("first");
  React.useDebugValue("second");
  return status;
};

const DebugValueComponent = () => {
  const status = useStatusWithDebugValue();
  return <div>{status}</div>;
};

const FormattedDebugValueComponent = () => {
  const status = useStatusWithFormatter();
  return <div>{status}</div>;
};

const ManyDebugValuesComponent = () => {
  const status = useStatusWithManyDebugValues();
  return <div>{status}</div>;
};

const EffectFamilyComponent = () => {
  React.useEffect(() => {}, []);
  React.useLayoutEffect(() => {}, []);
  React.useInsertionEffect(() => {}, []);
  return <div />;
};

const unstable_useFancyValue = () => {
  const [fancyValue] = React.useState("fancy");
  return fancyValue;
};

const experimental_useShinyValue = () => {
  const [shinyValue] = React.useState("shiny");
  return shinyValue;
};

const use = () => {
  const [bareValue] = React.useState("bare");
  return bareValue;
};

const PrefixedHooksComponent = () => {
  unstable_useFancyValue();
  experimental_useShinyValue();
  use();
  return <div />;
};

let shouldThrowDuringInspection = false;
const ConditionallyThrowingComponent = () => {
  React.useState(0);
  if (shouldThrowDuringInspection) {
    throw new Error("inspection-only failure");
  }
  return <div />;
};

describe("getFiberHooks additional hook types", () => {
  it("inspects useContext values from providers", () => {
    let fiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        fiber = fiberRoot.current.child?.child ?? null;
      },
    });
    render(
      <ThemeContext.Provider value="dark">
        <ContextComponent />
      </ThemeContext.Provider>,
    );

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const contextHook = allHooks.find((hook) => hook.value === "dark");
    expect(contextHook).toBeDefined();
    expect(contextHook?.id).toBeNull();
  });

  it("inspects useSyncExternalStore", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<SyncExternalStoreComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    expect(allHooks.some((hook) => hook.name === "SyncExternalStore")).toBe(true);
  });

  it("inspects useDeferredValue", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<DeferredValueComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const hookValues = allHooks.map((hook) => hook.value);
    expect(hookValues).toContain("deferred-label");
  });

  it("inspects useOptimistic", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<OptimisticComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const hookValues = allHooks.map((hook) => hook.value);
    expect(hookValues).toContain(7);
  });

  it("inspects useActionState with a committed plain value", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<ActionStateComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const hookValues = allHooks.map((hook) => hook.value);
    expect(hookValues).toContain("action-initial");
  });

  it("inspects useFormStatus", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<FormStatusComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    expect(allHooks.length).toBeGreaterThanOrEqual(1);
  });

  it("inspects useImperativeHandle with a populated ref", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    const handleRef = React.createRef<{ focus: () => void }>();
    render(<ImperativeHandleComponent ref={handleRef} />);
    expect(handleRef.current).not.toBeNull();

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    expect(allHooks.some((hook) => hook.name === "ImperativeHandle")).toBe(true);
    expect(allHooks.some((hook) => hook.value === handleRef.current)).toBe(true);
  });

  it("names custom hooks that report debug values", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<DebugValueComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    expect(allHooks.some((hook) => hook.name === "StatusWithDebugValue")).toBe(true);
    expect(allHooks.some((hook) => hook.name === "DebugValue")).toBe(true);
  });

  it("applies debug value formatters", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<FormattedDebugValueComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    expect(allHooks.some((hook) => hook.value === "formatted:online")).toBe(true);
  });

  it("captures each debug value in the tree", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<ManyDebugValuesComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const hookValues = allHooks.map((hook) => hook.value);
    expect(hookValues).toContain("first");
    expect(hookValues).toContain("second");
  });

  it("inspects the full effect hook family", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<EffectFamilyComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const hookNames = allHooks.map((hook) => hook.name);
    expect(hookNames).toContain("Effect");
    expect(hookNames).toContain("LayoutEffect");
    expect(hookNames).toContain("InsertionEffect");
  });

  it("strips unstable_ and experimental_ prefixes from custom hook names", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<PrefixedHooksComponent />);

    const hooks = getFiberHooks(fiber!);
    const allHooks = collectAllHooks(hooks);
    const hookNames = allHooks.map((hook) => hook.name);
    expect(hookNames).toContain("FancyValue");
    expect(hookNames).toContain("ShinyValue");
    expect(hookNames).toContain("Use");
  });

  it("wraps errors thrown while re-rendering the component", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    shouldThrowDuringInspection = false;
    render(<ConditionallyThrowingComponent />);
    shouldThrowDuringInspection = true;

    try {
      expect(() => getFiberHooks(fiber!)).toThrowError(
        expect.objectContaining({
          name: "ReactDebugToolsRenderError",
          message: "Error rendering inspected component",
        }),
      );
    } finally {
      shouldThrowDuringInspection = false;
    }
  });
});
