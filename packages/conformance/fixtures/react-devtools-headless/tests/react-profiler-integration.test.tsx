import "../src/index.js";

import { act, cleanup, render } from "@testing-library/react";
import { traverseFiber } from "bippy";
import type { Fiber } from "bippy";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { installFacade } from "../src/facade.js";
import type { Facade } from "../src/types.js";

interface ErrorBoundaryState {
  error: Error | null;
}

let facade: Facade;

const getFiber = (displayName: string): Fiber => {
  for (const roots of facade.fiberRoots.values()) {
    for (const root of roots) {
      const fiber = traverseFiber(root.current, (candidateFiber) => {
        const type = candidateFiber.type;
        return (
          (typeof type === "function" && type.name === displayName) ||
          (typeof type === "string" && type === displayName)
        );
      });
      if (fiber) return fiber;
    }
  }
  throw new Error(`Missing ${displayName}`);
};

beforeEach(() => {
  facade = installFacade();
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

describe("upstream React Profiler DevTools integration", () => {
  it("should auto-Profile all fibers if the DevTools hook is detected", () => {
    const Leaf = () => <span>leaf</span>;
    const App = () => <Leaf />;
    render(<App />);
    for (const name of ["App", "Leaf", "span"]) {
      const fiber = getFiber(name);
      expect(fiber.actualDuration).toBeGreaterThanOrEqual(0);
      expect(fiber.treeBaseDuration).toBeGreaterThanOrEqual(0);
    }
  });

  it("should reset the fiber stack correctly after an error when profiling host roots", () => {
    class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
      state: ErrorBoundaryState = { error: null };

      static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
      }

      render() {
        return this.state.error ? <div>failed</div> : this.props.children;
      }
    }
    const Throws = ({ shouldThrow }: { shouldThrow: boolean }) => {
      if (shouldThrow) throw new Error("Oops");
      return <section>safe</section>;
    };
    const rendered = render(
      <ErrorBoundary key="safe">
        <Throws shouldThrow={false} />
      </ErrorBoundary>,
    );
    rendered.rerender(
      <ErrorBoundary key="error">
        <Throws shouldThrow />
      </ErrorBoundary>,
    );
    rendered.rerender(
      <ErrorBoundary key="recovered">
        <Throws shouldThrow={false} />
      </ErrorBoundary>,
    );
    const fiber = getFiber("section");
    expect(fiber.actualDuration).toBeGreaterThanOrEqual(0);
    expect(fiber.treeBaseDuration).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(fiber.treeBaseDuration)).toBe(true);
  });

  it("regression test: #17159", () => {
    const renderLog: string[] = [];
    let setText: React.Dispatch<React.SetStateAction<string>> = () => undefined;
    let setUrgent: React.Dispatch<React.SetStateAction<number>> = () => undefined;
    const App = () => {
      const [text, updateText] = React.useState("A");
      const [urgent, updateUrgent] = React.useState(0);
      setText = updateText;
      setUrgent = updateUrgent;
      renderLog.push(`${text}:${urgent}`);
      return <div>{`${text}:${urgent}`}</div>;
    };
    render(<App />);
    renderLog.length = 0;
    const now = vi.spyOn(performance, "now").mockReturnValue(10_000);
    act(() => {
      React.startTransition(() => setText("B"));
      setUrgent(1);
    });
    expect(renderLog).toEqual(["A:1", "B:1"]);
    now.mockRestore();
  });
});
