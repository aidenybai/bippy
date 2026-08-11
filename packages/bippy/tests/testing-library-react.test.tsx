import "../src/index.js";

import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { expect, it, vi } from "vite-plus/test";
import { instrument, traverseFiber } from "../src/index.js";
import type { FiberRoot } from "../src/react-internals/index.js";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  didError: boolean;
}

interface ThrowingChildProps {
  shouldThrow: boolean;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { didError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { didError: true };
  }

  render(): React.ReactNode {
    return this.state.didError ? <span>recovered</span> : this.props.children;
  }
}

const HydratedCounter = () => {
  const [count, setCount] = React.useState(0);
  return <button onClick={() => setCount((value) => value + 1)}>count:{count}</button>;
};

const ThrowingChild = ({ shouldThrow }: ThrowingChildProps) => {
  if (shouldThrow) throw new Error("render failure");
  return <span>healthy</span>;
};

it("tracks Testing Library hydration and event-driven updates", () => {
  const committedRoots: FiberRoot[] = [];
  const unsubscribe = instrument({
    onCommitFiberRoot: (_rendererId, root) => committedRoots.push(root),
  });
  const container = document.createElement("div");
  container.innerHTML = "<button>count:0</button>";
  const instance = render(<HydratedCounter />, { container, hydrate: true });
  fireEvent.click(instance.getByRole("button"));

  expect(instance.getByRole("button").textContent).toBe("count:1");
  expect(committedRoots.length).toBeGreaterThanOrEqual(2);
  expect(
    traverseFiber(
      committedRoots.at(-1)?.current ?? null,
      (fiber) => fiber.type === HydratedCounter,
    ),
  ).not.toBeNull();
  unsubscribe();
});

it("tracks error-boundary recovery commits", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const onCommitFiberRoot = vi.fn();
  const unsubscribe = instrument({ onCommitFiberRoot });
  try {
    const instance = render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>,
    );
    instance.rerender(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(instance.getByText("recovered")).toBeDefined();
    expect(onCommitFiberRoot).toHaveBeenCalled();
  } finally {
    unsubscribe();
    consoleError.mockRestore();
  }
});
