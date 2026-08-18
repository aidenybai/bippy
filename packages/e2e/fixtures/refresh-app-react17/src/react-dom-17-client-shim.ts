// Minimal react-dom/client surface over React 17's legacy ReactDOM API so
// the shared harness can drive legacy roots with the same code.
import type { ReactNode } from "react";
import * as ReactDOM from "react-dom";

export interface Root {
  render(children: ReactNode): void;
  unmount(): void;
}

export interface RootOptions {
  onUncaughtError?: (error: unknown) => void;
}

export const createRoot = (container: Element, _rootOptions?: RootOptions): Root => ({
  render: (children) => {
    ReactDOM.render(children as Parameters<typeof ReactDOM.render>[0], container);
  },
  unmount: () => {
    ReactDOM.unmountComponentAtNode(container);
  },
});
