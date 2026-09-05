import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ErrorBoundary } from "../src/error-boundary.js";
import { EventEmitter } from "../src/event-emitter.js";
import {
  logErrorEvent,
  registerDevToolsEventLogger,
  registerEventLogger,
  StoreErrorSource,
  subscribeToStoreErrors,
} from "../src/logger.js";

afterEach(cleanup);

describe("upstream error reporting behavior", () => {
  it("reports a Store error before the frontend mounts", () => {
    const store = new StoreErrorSource();
    const bridge = new EventEmitter();
    const logger = vi.fn();
    const unregisterLogger = registerEventLogger(logger);
    const unsubscribe = subscribeToStoreErrors(store, bridge);
    const error = new Error("Initial render error");
    expect(() => store.throwAndEmitError(error)).toThrow(error);
    expect(logger).toHaveBeenCalledOnce();
    expect(logger).toHaveBeenCalledWith({
      error_component_stack: null,
      error_message: error.message,
      error_stack: error.stack,
      event_name: "error",
    });
    unsubscribe();
    unregisterLogger();
  });

  it("reports a Store error once when multiple error boundaries observe it", () => {
    const store = new StoreErrorSource();
    const logger = vi.fn();
    const unregisterLogger = registerEventLogger(logger);
    const unsubscribe = subscribeToStoreErrors(store);
    const view = render(
      <>
        <ErrorBoundary store={store}>First</ErrorBoundary>
        <ErrorBoundary store={store}>Second</ErrorBoundary>
        <ErrorBoundary store={store}>Third</ErrorBoundary>
      </>,
    );
    const error = new Error("Store error");
    expect(() => act(() => store.throwAndEmitError(error))).toThrow(error);
    act(() => undefined);
    expect(logger).toHaveBeenCalledOnce();
    expect(view.container.textContent?.match(/Uncaught Error: Store error/g) ?? []).toHaveLength(3);
    unsubscribe();
    unregisterLogger();
  });

  it("registers the event logger once while its iframe is loading", () => {
    const loggingUrl = "about:blank";
    registerDevToolsEventLogger("test", loggingUrl);
    registerDevToolsEventLogger("test", loggingUrl);
    expect(document.querySelectorAll(`iframe[src="${loggingUrl}"]`)).toHaveLength(1);
  });

  it("normalizes values that are not Error objects", () => {
    const logger = vi.fn();
    const unregisterLogger = registerEventLogger(logger);
    logErrorEvent(null, null);
    logErrorEvent({ message: 42, stack: {} }, null);
    const expected = {
      error_component_stack: null,
      error_message: null,
      error_stack: null,
      event_name: "error",
    };
    expect(logger).toHaveBeenNthCalledWith(1, expected);
    expect(logger).toHaveBeenNthCalledWith(2, expected);
    unregisterLogger();
  });
});
