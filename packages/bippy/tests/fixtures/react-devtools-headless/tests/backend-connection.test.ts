import { describe, expect, it, vi } from "vite-plus/test";
import { connectToDevTools } from "../src/backend-connection.js";
import type { DevToolsWebSocket } from "../src/backend-connection.js";

describe("upstream backend connection behavior", () => {
  it("shuts down cleanly when the WebSocket closes", () => {
    const onShutdown = vi.fn();
    const websocket: DevToolsWebSocket = {
      CLOSED: 3,
      OPEN: 1,
      readyState: 1,
      send: vi.fn(),
    };
    connectToDevTools({ onShutdown, websocket });
    websocket.onopen?.();
    websocket.readyState = websocket.CLOSED;
    websocket.onclose?.();
    websocket.onclose?.();
    expect(onShutdown).toHaveBeenCalledOnce();
  });
});
