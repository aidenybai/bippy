import { describe, expect, it, vi } from "vite-plus/test";
import { EventEmitter } from "../src/event-emitter.js";

describe("upstream EventEmitter behavior", () => {
  it("can dispatch an event with no listeners", () => {
    expect(() => new EventEmitter().emit("event", 123)).not.toThrow();
  });

  it("handles a listener being attached multiple times", () => {
    const dispatcher = new EventEmitter();
    const callback = vi.fn();
    dispatcher.addListener("event", callback);
    dispatcher.addListener("event", callback);
    dispatcher.emit("event", 123);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(123);
  });

  it("notifies all attached listeners of events", () => {
    const dispatcher = new EventEmitter();
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const otherCallback = vi.fn();
    dispatcher.addListener("event", firstCallback);
    dispatcher.addListener("event", secondCallback);
    dispatcher.addListener("other-event", otherCallback);
    dispatcher.emit("event", 123);
    expect(firstCallback).toHaveBeenCalledWith(123);
    expect(secondCallback).toHaveBeenCalledWith(123);
    expect(otherCallback).not.toHaveBeenCalled();
  });

  it("calls later listeners before re-throwing if an earlier one throws", () => {
    const dispatcher = new EventEmitter();
    const callback = vi.fn();
    dispatcher.addListener("event", () => {
      throw new Error("expected");
    });
    dispatcher.addListener("event", callback);
    expect(() => dispatcher.emit("event", 123)).toThrow("expected");
    expect(callback).toHaveBeenCalledWith(123);
  });

  it("preserves the first thrown value and reports later errors", () => {
    const dispatcher = new EventEmitter();
    const laterError = new Error("later error");
    const errorHandler = vi.fn((event: ErrorEvent) => event.preventDefault());
    const finalCallback = vi.fn();
    dispatcher.addListener("event", () => {
      throw null;
    });
    dispatcher.addListener("event", () => {
      throw laterError;
    });
    dispatcher.addListener("event", finalCallback);
    vi.stubGlobal("reportError", (error: unknown) => {
      window.dispatchEvent(new ErrorEvent("error", { cancelable: true, error }));
    });
    window.addEventListener("error", errorHandler);
    let caughtValue: unknown = undefined;
    try {
      dispatcher.emit("event", 123);
    } catch (error) {
      caughtValue = error;
    } finally {
      window.removeEventListener("error", errorHandler);
      vi.unstubAllGlobals();
    }
    expect(caughtValue).toBeNull();
    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0]?.[0]).toMatchObject({ error: laterError });
    expect(finalCallback).toHaveBeenCalledWith(123);
  });

  it("removes attached listeners", () => {
    const dispatcher = new EventEmitter();
    const eventCallback = vi.fn();
    const otherCallback = vi.fn();
    dispatcher.addListener("event", eventCallback);
    dispatcher.addListener("other-event", otherCallback);
    dispatcher.removeListener("event", eventCallback);
    dispatcher.emit("event", 123);
    dispatcher.emit("other-event", 123);
    expect(eventCallback).not.toHaveBeenCalled();
    expect(otherCallback).toHaveBeenCalledWith(123);
  });

  it("removes all listeners", () => {
    const dispatcher = new EventEmitter();
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    dispatcher.addListener("event", firstCallback);
    dispatcher.addListener("other-event", secondCallback);
    dispatcher.removeAllListeners();
    dispatcher.emit("event", 123);
    dispatcher.emit("other-event", 123);
    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).not.toHaveBeenCalled();
  });

  it("should call the initial listeners even if others are added or removed during a dispatch", () => {
    const dispatcher = new EventEmitter();
    const secondCallback = vi.fn();
    const thirdCallback = vi.fn();
    const firstCallback = vi.fn(() => {
      dispatcher.removeListener("event", secondCallback);
      dispatcher.addListener("event", thirdCallback);
    });
    dispatcher.addListener("event", firstCallback);
    dispatcher.addListener("event", secondCallback);
    dispatcher.emit("event", 123);
    expect(secondCallback).toHaveBeenCalledWith(123);
    expect(thirdCallback).not.toHaveBeenCalled();
    dispatcher.emit("event", 456);
    expect(secondCallback).toHaveBeenCalledOnce();
    expect(thirdCallback).toHaveBeenCalledWith(456);
  });
});
