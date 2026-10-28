import { getRecordedError } from "./errors";
import {
  findMountedFiber,
  getMountedType,
  hasPendingReactWork,
  hasSuspendedReactWork,
} from "./fibers";
import { createOpenObject } from "./hydrate";
import {
  SHORT_CALLBACK_MS,
  hasPendingCallbacks,
  hasPendingPassiveFlush,
  nativeClearTimeout,
  nativeRequestAnimationFrame,
  nativeSetTimeout,
} from "./pending-callbacks";

const SETTLE_MS = SHORT_CALLBACK_MS;
const MAX_SETTLE_MS = 3000;
const POLL_MS = 4;

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
  hasPendingPassiveFlush() ||
  (getMountedType() !== null && !findMountedFiber() && !getRecordedError());

export const settle = async (): Promise<void> => {
  const start = performance.now();
  const deadline = start + MAX_SETTLE_MS;
  let quietDeadline = start + SETTLE_MS;
  await waitForFrame();
  while (performance.now() < deadline) {
    const isWorking = isBusy();
    if (isWorking) quietDeadline = performance.now() + SETTLE_MS;
    const isWaiting = hasPendingCallbacks() || hasSuspendedReactWork();
    if (!isWorking && (!isWaiting || performance.now() >= quietDeadline)) return;
    await waitForPoll();
  }
};

export const drain = async (): Promise<void> => {
  const deadline = performance.now() + MAX_SETTLE_MS;
  while (isBusy() && performance.now() < deadline) await waitForPoll();
};
