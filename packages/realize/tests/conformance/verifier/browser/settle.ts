import { getRecordedError } from "./errors";
import {
  findMountedFiber,
  getMountedType,
  hasPendingReactWork,
  hasSuspendedReactWork,
} from "./fibers";
import { createOpenObject } from "./hydrate";

const SETTLE_MS = 40;
const MAX_SETTLE_MS = 3000;
const POLL_MS = 4;

const nativeSetTimeout = window.setTimeout.bind(window);
const nativeClearTimeout = window.clearTimeout.bind(window);
const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
const pendingTimers = new Set<number>();
const pendingFrames = new Set<number>();
let pendingObservations = 0;

window.setTimeout = ((handler: TimerHandler, timeout?: number, ...timerArguments: unknown[]) => {
  if (typeof handler !== "function" || Number(timeout ?? 0) > SETTLE_MS)
    return nativeSetTimeout(handler, timeout, ...timerArguments);
  const timerId = nativeSetTimeout(() => {
    pendingTimers.delete(timerId);
    Reflect.apply(handler, window, timerArguments);
  }, timeout);
  pendingTimers.add(timerId);
  return timerId;
}) as typeof window.setTimeout;

window.clearTimeout = ((timerId?: number): void => {
  if (timerId !== undefined) pendingTimers.delete(timerId);
  nativeClearTimeout(timerId);
}) as typeof window.clearTimeout;

window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
  const frameId = nativeRequestAnimationFrame((time) => {
    pendingFrames.delete(frameId);
    callback(time);
  });
  pendingFrames.add(frameId);
  return frameId;
};

window.cancelAnimationFrame = (frameId: number): void => {
  pendingFrames.delete(frameId);
  nativeCancelAnimationFrame(frameId);
};

interface ObservationCount {
  pending: number;
}

const settleObservations = (count: ObservationCount): void => {
  pendingObservations -= count.pending;
  count.pending = 0;
};

const NativeIntersectionObserver = window.IntersectionObserver;
window.IntersectionObserver = class extends NativeIntersectionObserver {
  readonly #count: ObservationCount;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    const count = { pending: 0 };
    super((entries, observer) => {
      settleObservations(count);
      callback(entries, observer);
    }, options);
    this.#count = count;
  }

  override observe(target: Element): void {
    this.#count.pending++;
    pendingObservations++;
    super.observe(target);
  }

  override disconnect(): void {
    settleObservations(this.#count);
    super.disconnect();
  }
};

const NativeResizeObserver = window.ResizeObserver;
window.ResizeObserver = class extends NativeResizeObserver {
  readonly #count: ObservationCount;

  constructor(callback: ResizeObserverCallback) {
    const count = { pending: 0 };
    super((entries, observer) => {
      settleObservations(count);
      callback(entries, observer);
    });
    this.#count = count;
  }

  override observe(target: Element, options?: ResizeObserverOptions): void {
    this.#count.pending++;
    pendingObservations++;
    super.observe(target, options);
  }

  override disconnect(): void {
    settleObservations(this.#count);
    super.disconnect();
  }
};

let pendingRequests = 0;

const trackRequest = <Result>(request: Promise<Result>): Promise<Result> => {
  pendingRequests++;
  return request.finally(() => pendingRequests--);
};

const createStandInResponse = (): Response => {
  const response = new Response("{}", { headers: { "content-type": "application/json" } });
  Object.defineProperty(response, "json", {
    value: async () => createOpenObject({ error: undefined, errors: undefined }),
  });
  return response;
};

const originalFetch = window.fetch;
window.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  return trackRequest(
    url.origin === location.origin || !url.protocol.startsWith("http")
      ? originalFetch(input, init)
      : Promise.resolve(createStandInResponse()),
  );
};
const originalSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function send(...sendArguments) {
  pendingRequests++;
  this.addEventListener("loadend", () => pendingRequests--, { once: true });
  originalSend.apply(this, sendArguments);
};

const waitForPoll = (): Promise<void> =>
  new Promise((resolve) => nativeSetTimeout(resolve, POLL_MS));

const waitForFrame = (): Promise<void> =>
  new Promise((resolve) => {
    const fallbackId = nativeSetTimeout(resolve, SETTLE_MS);
    nativeRequestAnimationFrame(() => {
      nativeClearTimeout(fallbackId);
      nativeSetTimeout(resolve, 0);
    });
  });

const isBusy = (): boolean =>
  pendingRequests > 0 ||
  hasPendingReactWork() ||
  (getMountedType() !== null && !findMountedFiber() && !getRecordedError());

const hasPendingCallbacks = (): boolean =>
  pendingTimers.size > 0 ||
  pendingFrames.size > 0 ||
  pendingObservations > 0 ||
  hasSuspendedReactWork();

export const settle = async (): Promise<void> => {
  const start = performance.now();
  const deadline = start + MAX_SETTLE_MS;
  let quietDeadline = start + SETTLE_MS;
  await waitForFrame();
  while (performance.now() < deadline) {
    const isWorking = isBusy();
    if (isWorking) quietDeadline = performance.now() + SETTLE_MS;
    if (!isWorking && (!hasPendingCallbacks() || performance.now() >= quietDeadline)) return;
    await waitForPoll();
  }
};

export const drain = async (): Promise<void> => {
  const deadline = performance.now() + MAX_SETTLE_MS;
  while (isBusy() && performance.now() < deadline) await waitForPoll();
};
