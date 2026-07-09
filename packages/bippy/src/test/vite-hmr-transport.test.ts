import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeWebSocket } from "./fake-web-socket.js";
import {
  createViteHmrTransport,
  parseViteUpdatePaths,
} from "../react-refresh/vite-hmr-transport.js";

const buildViteClientResponse = (clientSource: string) => ({
  ok: true,
  text: () => Promise.resolve(clientSource),
});

const VITE_CLIENT_SOURCE_WITH_TOKEN = 'const wsToken = "test-token";';

const installFakeFetch = () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const buildViteUpdateMessage = (acceptedPath: string): string =>
  JSON.stringify({
    type: "update",
    updates: [{ type: "js-update", acceptedPath }],
  });

describe("parseViteUpdatePaths", () => {
  it("skips non-object update entries", () => {
    const message = JSON.stringify({
      type: "update",
      updates: ["not an object", null, { type: "js-update", acceptedPath: "/src/app.tsx" }],
    });
    expect(parseViteUpdatePaths(message)).toEqual(["/src/app.tsx"]);
  });
});

describe("createViteHmrTransport", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns null when WebSocket is unavailable", async () => {
    vi.stubGlobal("WebSocket", undefined);
    const fetchMock = installFakeFetch();
    await expect(createViteHmrTransport(() => {})).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when fetching /@vite/client rejects", async () => {
    installFakeWebSocket();
    const fetchMock = installFakeFetch();
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(createViteHmrTransport(() => {})).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/@vite/client");
  });

  it("returns null when /@vite/client responds non-200", async () => {
    installFakeWebSocket();
    const fetchMock = installFakeFetch();
    fetchMock.mockResolvedValue({ ok: false, text: () => Promise.resolve("") });
    await expect(createViteHmrTransport(() => {})).resolves.toBeNull();
  });

  it("returns null when the client source has no wsToken", async () => {
    const socketInstances = installFakeWebSocket();
    const fetchMock = installFakeFetch();
    fetchMock.mockResolvedValue(buildViteClientResponse("export const noToken = true;"));
    await expect(createViteHmrTransport(() => {})).resolves.toBeNull();
    expect(socketInstances).toHaveLength(0);
  });

  it("connects with the scraped token and forwards js-update paths", async () => {
    const socketInstances = installFakeWebSocket();
    const fetchMock = installFakeFetch();
    fetchMock.mockResolvedValue(buildViteClientResponse(VITE_CLIENT_SOURCE_WITH_TOKEN));

    const onHmrUpdate = vi.fn();
    const transport = await createViteHmrTransport(onHmrUpdate);
    expect(transport).not.toBeNull();
    expect(socketInstances).toHaveLength(1);
    expect(socketInstances[0].url).toBe(`ws://${location.host}/?token=test-token`);
    expect(socketInstances[0].protocol).toBe("vite-hmr");

    socketInstances[0].onmessage?.({ data: buildViteUpdateMessage("/src/app.tsx") });
    expect(onHmrUpdate).toHaveBeenCalledWith(["/src/app.tsx"]);

    socketInstances[0].onmessage?.({ data: JSON.stringify({ type: "connected" }) });
    expect(onHmrUpdate).toHaveBeenCalledTimes(1);

    transport?.dispose();
    expect(socketInstances[0].didClose).toBe(true);
    expect(socketInstances[0].onclose).toBeNull();
  });

  it("uses wss when the page is served over https", async () => {
    vi.stubGlobal("location", { protocol: "https:", host: "secure.example" });
    const socketInstances = installFakeWebSocket();
    const fetchMock = installFakeFetch();
    fetchMock.mockResolvedValue(buildViteClientResponse(VITE_CLIENT_SOURCE_WITH_TOKEN));

    const transport = await createViteHmrTransport(() => {});
    expect(socketInstances[0].url).toBe("wss://secure.example/?token=test-token");
    transport?.dispose();
  });

  it("reconnects with a freshly fetched token after the socket closes", async () => {
    vi.useFakeTimers();
    const socketInstances = installFakeWebSocket();
    const fetchMock = installFakeFetch();
    fetchMock.mockResolvedValue(
      buildViteClientResponse(VITE_CLIENT_SOURCE_WITH_TOKEN.replace("test-token", "first-token")),
    );

    const transport = await createViteHmrTransport(() => {});
    expect(socketInstances).toHaveLength(1);

    fetchMock.mockResolvedValue(
      buildViteClientResponse(VITE_CLIENT_SOURCE_WITH_TOKEN.replace("test-token", "fresh-token")),
    );
    socketInstances[0].onclose?.();
    expect(socketInstances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(socketInstances).toHaveLength(2);
    expect(socketInstances[1].url).toBe(`ws://${location.host}/?token=fresh-token`);

    transport?.dispose();
  });

  it("keeps retrying when the token re-fetch fails", async () => {
    vi.useFakeTimers();
    const socketInstances = installFakeWebSocket();
    const fetchMock = installFakeFetch();
    fetchMock.mockResolvedValueOnce(buildViteClientResponse(VITE_CLIENT_SOURCE_WITH_TOKEN));

    const transport = await createViteHmrTransport(() => {});
    fetchMock.mockRejectedValueOnce(new Error("dev server restarting"));
    socketInstances[0].onclose?.();

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(socketInstances).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(buildViteClientResponse(VITE_CLIENT_SOURCE_WITH_TOKEN));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(socketInstances).toHaveLength(2);

    transport?.dispose();
  });

  it("does not reconnect when disposed while the token re-fetch is in flight", async () => {
    vi.useFakeTimers();
    const socketInstances = installFakeWebSocket();
    const fetchMock = installFakeFetch();
    fetchMock.mockResolvedValueOnce(buildViteClientResponse(VITE_CLIENT_SOURCE_WITH_TOKEN));

    const transport = await createViteHmrTransport(() => {});
    let resolveTokenFetch: ((response: unknown) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTokenFetch = resolve;
        }),
    );
    socketInstances[0].onclose?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    transport?.dispose();
    resolveTokenFetch?.(buildViteClientResponse(VITE_CLIENT_SOURCE_WITH_TOKEN));
    await vi.advanceTimersByTimeAsync(1000);
    expect(socketInstances).toHaveLength(1);
  });

  it("dispose cancels a pending reconnect timer", async () => {
    vi.useFakeTimers();
    const socketInstances = installFakeWebSocket();
    const fetchMock = installFakeFetch();
    fetchMock.mockResolvedValueOnce(buildViteClientResponse(VITE_CLIENT_SOURCE_WITH_TOKEN));

    const transport = await createViteHmrTransport(() => {});
    socketInstances[0].onclose?.();
    transport?.dispose();

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(socketInstances).toHaveLength(1);
  });

  it("ignores a close event delivered after dispose", async () => {
    vi.useFakeTimers();
    const socketInstances = installFakeWebSocket();
    const fetchMock = installFakeFetch();
    fetchMock.mockResolvedValue(buildViteClientResponse(VITE_CLIENT_SOURCE_WITH_TOKEN));

    const transport = await createViteHmrTransport(() => {});
    const capturedCloseHandler = socketInstances[0].onclose;
    transport?.dispose();

    capturedCloseHandler?.();
    expect(vi.getTimerCount()).toBe(0);
  });
});
