import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { WebSocket, WebSocketServer } from "ws";
import type { Browser, Frame } from "@playwright/test";
import {
  getIsFiberCapture,
  maxCapturedFibers,
  type InspectionFrame,
  type InspectionMessage,
} from "../src/inspector/inspection-protocol";

interface InspectionClientInfo {
  origin: string;
  req: IncomingMessage;
}

export interface InspectionSessionOptions {
  browser: Browser;
  targetUrl: string;
  viewerUrl: string;
}

const getDisplayUrl = (url: string) => {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) return "about:blank";
  return `${parsed.origin}${parsed.pathname}`.slice(0, 2048);
};

export const createInspectionSession = async ({
  browser,
  targetUrl,
  viewerUrl,
}: InspectionSessionOptions) => {
  const target = new URL(targetUrl);
  const viewer = new URL(viewerUrl);
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("The target must be an HTTP or HTTPS app.");
  if (viewer.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(viewer.hostname))
    throw new Error("The inspector must run on local HTTP.");
  const sessionToken = randomUUID();
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    maxPayload: 1024,
    verifyClient: ({ origin, req }: InspectionClientInfo) =>
      origin === viewer.origin &&
      new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("session") === sessionToken,
  });
  await once(server, "listening");
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("Missing inspector socket address.");
  const bridgeUrl = `ws://127.0.0.1:${address.port}/?session=${sessionToken}`;
  viewer.hash = new URLSearchParams({ bridge: bridgeUrl }).toString();
  const appContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const appPage = await appContext.newPage();
  const viewerPage = await viewerContext.newPage();
  const frames = new Map<Frame, InspectionFrame>();
  const frameIds = new WeakMap<Frame, number>();
  let nextFrameId = 1;
  let isStopped = false;
  let message: InspectionMessage = {
    type: "bippy:inspection",
    sequence: 0,
    capturedAt: Date.now(),
    target: getDisplayUrl(targetUrl),
    status: "loading",
    frames: [],
  };
  const publish = (status: InspectionMessage["status"], error?: string) => {
    if (isStopped) return;
    message = {
      ...message,
      sequence: message.sequence + 1,
      capturedAt: Date.now(),
      status,
      error,
      frames: [...frames.values()],
    };
    const serialized = JSON.stringify(message);
    for (const client of server.clients)
      if (client.readyState === WebSocket.OPEN) client.send(serialized);
  };
  server.on("connection", (client) => {
    client.on("error", () => client.terminate());
    client.send(JSON.stringify(message));
  });
  const stop = async () => {
    if (isStopped) return;
    publish("closed");
    isStopped = true;
    for (const client of server.clients) client.terminate();
    await Promise.allSettled([
      appContext.close(),
      viewerContext.close(),
      new Promise<void>((resolve) => server.close(() => resolve())),
    ]);
  };
  try {
    await appContext.exposeBinding("__bippyDiagramCapture", (source, capture: unknown) => {
      if (
        isStopped ||
        source.page !== appPage ||
        new URL(source.frame.url()).origin !== target.origin ||
        !getIsFiberCapture(capture)
      )
        return;
      let frameId = frameIds.get(source.frame);
      if (frameId === undefined) {
        frameId = nextFrameId++;
        frameIds.set(source.frame, frameId);
      }
      const remainingCount = [...frames.entries()].reduce(
        (count, [frame, current]) =>
          frame === source.frame
            ? count
            : count +
              current.roots.reduce(
                (total, root) => total + root.nodes.length + root.details.length,
                0,
              ),
        0,
      );
      if (
        remainingCount +
          capture.roots.reduce(
            (count, root) => count + root.nodes.length + root.details.length,
            0,
          ) >
          maxCapturedFibers ||
        (!frames.has(source.frame) && frames.size >= 16)
      ) {
        publish("error", "The app exceeds the live capture budget.");
        return;
      }
      frames.set(source.frame, {
        documentId: capture.documentId,
        roots: capture.roots,
        truncated: capture.truncated,
        id: `frame-${frameId}-${capture.documentId}`,
        url: getDisplayUrl(source.frame.url()),
      });
      publish([...frames.values()].some((frame) => frame.roots.length > 0) ? "live" : "loading");
    });
    const bundle = await build({
      entryPoints: [fileURLToPath(new URL("../src/inspector/capture-client.ts", import.meta.url))],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "es2022",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    // HACK: Firefox iframe init scripts can see an empty location; Window.origin already reflects the realm's security origin.
    await appContext.addInitScript({
      content: `if (globalThis.origin === ${JSON.stringify(target.origin)}) { ${bundle.outputFiles[0].text} }`,
    });
    appPage.on("framenavigated", (frame) => {
      frames.delete(frame);
      if (frame === appPage.mainFrame())
        message = { ...message, target: getDisplayUrl(frame.url()) };
      publish(
        [...frames.values()].some((current) => current.roots.length > 0) ? "live" : "loading",
      );
    });
    appPage.on("framedetached", (frame) => {
      frames.delete(frame);
      publish(frames.size ? "live" : "loading");
    });
    appPage.on("close", () => publish("closed"));
    viewerPage.on("close", () => {
      void stop();
    });
    await viewerPage.goto(viewer.toString());
    await appPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {
      publish(
        "error",
        "The app did not finish loading. Check the URL and network connection, then reload the app or restart the launcher.",
      );
    });
    return {
      appPage,
      viewerPage,
      bridgeUrl,
      viewerUrl: viewer.toString(),
      getMessage: () => message,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
};
