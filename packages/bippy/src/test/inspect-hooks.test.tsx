import "../index.js"; // KEEP THIS LINE ON TOP

import { describe, expect, it } from "vitest";
import type { Fiber } from "../types.js";
import { instrument } from "../index.js";
import { inspectHooks, inspectHooksOfFiber, type HooksNode } from "../source/inspect-hooks.js";
import React from "react";
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

describe("inspectHooksOfFiber", () => {
  it("returns a non-empty hooks tree for a stateful component", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<StateComponent />);

    const hooks = inspectHooksOfFiber(fiber!);
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

    const hooks = inspectHooksOfFiber(fiber!);
    const allHooks = collectAllHooks(hooks);
    expect(allHooks.length).toBeGreaterThanOrEqual(1);
  });

  it("returns hook values for useReducer", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<ReducerComponent />);

    const hooks = inspectHooksOfFiber(fiber!);
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

    const hooks = inspectHooksOfFiber(fiber!);
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

    const hooks = inspectHooksOfFiber(fiber!);
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

    const hooks = inspectHooksOfFiber(fiber!);
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

    const hooks = inspectHooksOfFiber(fiber!);
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

    const hooks = inspectHooksOfFiber(fiber!);
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

    const hooks = inspectHooksOfFiber(fiber!);
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

    expect(() => inspectHooksOfFiber(fiber!)).toThrow(
      "Unknown Fiber. Needs to be a function component to inspect hooks.",
    );
  });

  it("assigns sequential numeric IDs to stateful hooks", () => {
    let fiber: Fiber | null = null;
    captureFiber((fiberNode) => {
      fiber = fiberNode;
    });
    render(<MultiHookComponent />);

    const hooks = inspectHooksOfFiber(fiber!);
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

    const hooks = inspectHooksOfFiber(fiber!);
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

    const hooks = inspectHooksOfFiber(fiber!);
    const allHooks = collectAllHooks(hooks);
    for (const hook of allHooks) {
      expect(hook).toHaveProperty("hookSource");
    }
  });
});

describe("inspectHooks (standalone)", () => {
  it("inspects a render function without fiber context", () => {
    render(<StateComponent />);

    const hooks = inspectHooks(StateComponent, {});
    const allHooks = collectAllHooks(hooks);
    expect(allHooks.length).toBeGreaterThanOrEqual(2);
  });
});
