import { createHash } from "node:crypto";
import { Window as HappyWindow } from "happy-dom";
import { GlobalEnvironmentRecord } from "#engine";
import { loadHostRealm } from "../host/host-realm.js";
import { createDomHost } from "../render/dom-host.js";
import type { TimerQueue } from "../evaluate/timers.js";
import type { EngineMembrane } from "./membrane.js";
import { VirtualClock } from "./virtual-clock.js";
import { HostOperations } from "./host-operations.js";

export interface BrowserResponse {
  body: string;
  status?: number;
  headers?: Record<string, string>;
}

export interface BrowserPlatformOptions {
  url?: string;
  documentShell?: string | null;
}

const clockGlobals = new Set([
  "Date",
  "performance",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "globalThis",
]);

export const createBrowserPlatform = (
  timers: TimerQueue,
  responses: Record<string, BrowserResponse> = {},
  randomSeed = 1,
  options: BrowserPlatformOptions = {},
) => {
  const browser = new HappyWindow({
    url: options.url ?? "https://bippy.invalid/",
    settings: {
      enableJavaScriptEvaluation: false,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      fetch: {
        interceptor: {
          beforeAsyncRequest: async ({ request, window }) => {
            const response = Object.hasOwn(responses, request.url)
              ? responses[request.url]
              : undefined;
            if (!response) throw new TypeError(`Network disabled: ${request.url}`);
            return new window.Response(response.body, {
              status: response.status ?? 200,
              headers: response.headers,
            });
          },
          beforeSyncRequest: () => {
            throw new TypeError("Synchronous network requests are disabled");
          },
        },
      },
    },
  });
  const view = browser as unknown as Window & typeof globalThis;
  for (const name of loadHostRealm("ecmascript").getGlobalNames()) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    if (descriptor && name !== "globalThis") Object.defineProperty(view, name, descriptor);
  }
  const clock = new VirtualClock(timers);
  const errors: unknown[] = [];
  if (options.documentShell) view.document.write(options.documentShell);
  view.addEventListener("error", (event) => {
    if (event instanceof view.ErrorEvent) errors.push(event.error);
  });
  const nativeCrypto = view.crypto;
  const operations = new HostOperations();
  const subtleMethods = new WeakMap<object, object>();
  const subtle = new Proxy(nativeCrypto.subtle, {
    get: (target, key) => {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function" || key === "constructor") return value;
      let method = subtleMethods.get(value);
      if (!method) {
        method = new Proxy(value, {
          apply: (callback, receiver, args) =>
            operations.track(
              Promise.resolve(
                Reflect.apply(callback, receiver === subtle ? target : receiver, args),
              ),
            ),
        });
        subtleMethods.set(value, method);
      }
      return method;
    },
  });
  let randomCounter = 0;
  const getBytes = () =>
    createHash("sha256")
      .update(`${randomSeed >>> 0}:${randomCounter++}`)
      .digest();
  const randomUUID = () => {
    const bytes = getBytes().subarray(0, 16);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const getRandomValues = (array: ArrayBufferView) => {
    nativeCrypto.getRandomValues(array);
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let offset = 0; offset < bytes.length; offset += 32)
      bytes.set(getBytes().subarray(0, Math.min(32, bytes.length - offset)), offset);
    return array;
  };
  const crypto = new Proxy(nativeCrypto, {
    get: (target, key) =>
      key === "subtle"
        ? subtle
        : key === "randomUUID"
          ? randomUUID
          : key === "getRandomValues"
            ? getRandomValues
            : Reflect.get(target, key, target),
  });
  const nativePerformance = view.performance;
  const performanceMethods = new Map<object, unknown>();
  const getNow = () => clock.now;
  const performance = new Proxy(nativePerformance, {
    get: (target, key) => {
      if (key === "now") return getNow;
      if (key === "timeOrigin") return clock.epoch;
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function" || key === "constructor") return value;
      let bound = performanceMethods.get(value);
      if (!bound) {
        bound = value.bind(target);
        performanceMethods.set(value, bound);
      }
      return bound;
    },
  });
  const properties = {
    globalThis: view,
    structuredClone,
    crypto,
    Date: clock.createDate(),
    Math: Object.create(Math),
    performance,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearTimeout,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.clearTimeout,
    queueMicrotask: (callback: () => void) =>
      queueMicrotask(() => {
        try {
          callback();
        } catch (error) {
          errors.push(error);
        }
      }),
    process: { env: { NODE_ENV: "development" } },
    WebSocket: new Proxy(view.WebSocket, {
      construct: () => {
        throw new TypeError("WebSocket connections are disabled");
      },
    }),
  };
  for (const [name, value] of Object.entries(properties))
    Object.defineProperty(view, name, { value, configurable: true, writable: true });
  // HACK: Happy DOM does not emit errors for disabled resource loads; release React's stylesheet waiters.
  const preloads = new view.MutationObserver((records) => {
    for (const record of records)
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof view.HTMLLinkElement && ["preload", "stylesheet"].includes(node.rel))
          queueMicrotask(() => node.dispatchEvent(new view.Event("error")));
      }
  });
  preloads.observe(view.document, { childList: true, subtree: true });
  const host = {
    ...createDomHost(false),
    isContainer: (value: unknown): value is Element => value instanceof view.Element,
    createRootContainer: () => view.document.createElement("div"),
    createContainer: () => view.document.createElement("div"),
    attachRootContainer: (container: Element | Document) => {
      if (container.nodeType === 9) return () => {};
      view.document.body.appendChild(container);
      return () => {
        container.parentNode?.removeChild(container);
      };
    },
  };
  const install = (membrane: EngineMembrane): void => {
    const { engine } = membrane;
    const keys = engine.getArray(engine.evaluate("Reflect.ownKeys(globalThis)"));
    const getDescriptor = engine.evaluate("(key)=>Object.getOwnPropertyDescriptor(globalThis,key)");
    for (const key of keys) {
      if (key.type !== "String" || clockGlobals.has(key.value)) continue;
      const descriptor = membrane.toHost(engine.call(getDescriptor, [key]));
      if (typeof descriptor !== "object" || descriptor === null)
        throw new Error("Expected global descriptor");
      Reflect.defineProperty(view, key.value, descriptor);
    }
    const global = engine.getObject(membrane.toEngine(view));
    engine.withAgent(() => {
      engine.realm.GlobalObject = global;
      engine.realm.GlobalEnv = new GlobalEnvironmentRecord(global, global);
    });
    engine.setGlobal("globalThis", global);
    engine.setGlobal("window", global);
    engine.setGlobal("self", global);
  };
  const dispose = async (): Promise<void> => {
    preloads.disconnect();
    await browser.happyDOM.abort();
    browser.close();
  };
  return { view, host, clock, errors, install, dispose, settleOperations: operations.settle };
};
