import "../src/index.js";

import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createTools, installFacade } from "../src/index.js";
import type { Facade, Tools } from "../src/index.js";

interface ErrorBoundaryState {
  hasError: boolean;
}

let facade: Facade;
let tools: Tools;

beforeEach(() => {
  facade = installFacade();
  tools = createTools(facade);
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

describe("upstream Store forcing errors", () => {
  it("resets forced error and fallback states when filters are changed", async () => {
    class AnyClassComponent extends React.Component<React.PropsWithChildren> {
      render() {
        return this.props.children;
      }
    }

    class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
      state: ErrorBoundaryState = { hasError: false };

      static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
      }

      render() {
        return this.state.hasError ? (
          <AnyClassComponent key="fallback">
            <div key="did-error">failed</div>
          </AnyClassComponent>
        ) : (
          this.props.children
        );
      }
    }

    const App = () => (
      <ErrorBoundary key="content">
        <div key="error-content">content</div>
      </ErrorBoundary>
    );

    const view = render(<App />);
    const tree = tools.getComponentTree();
    if (!Array.isArray(tree)) throw tree.error;
    const boundary = tree.find((node) => node.name === "ErrorBoundary");
    if (!boundary) throw new Error("Missing ErrorBoundary");

    act(() => {
      expect(tools.setError(boundary.uid, true)).toEqual({ success: true });
    });
    await waitFor(() => expect(view.container.textContent).toBe("failed"));

    act(() => {
      expect(tools.setError(boundary.uid, false)).toEqual({ success: true });
    });
    await waitFor(() => expect(view.container.textContent).toBe("content"));
  });
});
