import { describe, expect, it, vi } from "vite-plus/test";
import { Bridge } from "../src/bridge.js";
import type { Wall } from "../src/bridge.js";

interface ListenerHolder {
  listener?: (message: unknown) => void;
}

describe("upstream Bridge behavior", () => {
  it("should shutdown properly", async () => {
    const send = vi.fn();
    const wall: Wall = { listen: () => () => undefined, send };
    const bridge = new Bridge(wall);
    const shutdownCallback = vi.fn();
    bridge.addListener("shutdown", shutdownCallback);
    bridge.send("reloadAppForProfiling");
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith("reloadAppForProfiling", undefined);
    send.mockClear();
    bridge.send("update", "1");
    bridge.send("update", "2");
    bridge.shutdown();
    expect(send).toHaveBeenCalledWith("update", "1");
    expect(send).toHaveBeenCalledWith("update", "2");
    expect(send).toHaveBeenCalledWith("shutdown", undefined);
    expect(shutdownCallback).toHaveBeenCalledOnce();
    send.mockClear();
    expect(() => bridge.send("should not send")).toThrow(
      "Cannot send a message through a Bridge that has been shut down.",
    );
    expect(() => bridge.addListener("event", () => undefined)).toThrow(
      "Cannot add a listener through a Bridge that has been shut down.",
    );
    expect(() => bridge.emit("event")).toThrow(
      "Cannot emit an event through a Bridge that has been shut down.",
    );
    expect(() => bridge.shutdown()).toThrow(
      "Cannot shut down through a Bridge that has been shut down.",
    );
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
  });

  it("validates messages received from the wall", () => {
    const holder: ListenerHolder = {};
    const wall: Wall = {
      listen: (listener) => {
        holder.listener = listener;
        return () => undefined;
      },
      send: vi.fn(),
    };
    const bridge = new Bridge(wall);
    const listener = vi.fn();
    bridge.addListener("event", listener);
    const dispatch = (message: unknown): void => {
      if (!holder.listener) throw new Error("Bridge did not subscribe");
      holder.listener(message);
    };
    dispatch(null);
    dispatch({ type: "event" });
    expect(listener).not.toHaveBeenCalled();
    expect(() => dispatch({ event: 123 })).toThrow("Bridge event names must be non-empty strings.");
    expect(() => dispatch({ event: "" })).toThrow("Bridge event names must be non-empty strings.");
    dispatch({ event: "event", payload: 123 });
    expect(listener).toHaveBeenCalledWith(123);
  });

  it("requires Wall.listen to return a cleanup function", () => {
    expect(() => new Bridge({ listen: () => undefined, send: vi.fn() })).toThrow(
      "Wall.listen() must return an unlisten function.",
    );
  });

  it("flushes pending messages when wall cleanup throws", () => {
    const expectedError = new Error("Failed to unsubscribe");
    const send = vi.fn();
    const bridge = new Bridge({
      listen: () => () => {
        throw expectedError;
      },
      send,
    });
    bridge.send("update", "value");
    expect(() => bridge.shutdown()).toThrow(expectedError);
    expect(send).toHaveBeenCalledWith("update", "value");
    expect(send).toHaveBeenCalledWith("shutdown", undefined);
  });
});
