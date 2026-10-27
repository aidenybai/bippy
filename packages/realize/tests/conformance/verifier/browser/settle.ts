import { getRecordedError } from "./errors";
import { findMountedFiber, getMountedType, hasPendingReactWork } from "./fibers";
import { createOpenObject } from "./hydrate";

const SETTLE_MS = 40;
const MAX_SETTLE_MS = 3000;

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

const waitForSettleInterval = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

const isBusy = (): boolean =>
  pendingRequests > 0 ||
  hasPendingReactWork() ||
  (getMountedType() !== null && !findMountedFiber() && !getRecordedError());

export const settle = async (): Promise<void> => {
  const deadline = performance.now() + MAX_SETTLE_MS;
  do await waitForSettleInterval();
  while (isBusy() && performance.now() < deadline);
};

export const drain = async (): Promise<void> => {
  const deadline = performance.now() + MAX_SETTLE_MS;
  while (isBusy() && performance.now() < deadline) await waitForSettleInterval();
};
