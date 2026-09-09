/** How a promise the page holds has settled by capture time. */
export interface SettledPromise {
  isFulfilled: boolean;
  outcome: unknown;
}

const settledPromises = new WeakMap<Promise<unknown>, SettledPromise>();
const unsettledPromises = new Set<Promise<unknown>>();
const STILL_PENDING = Symbol("still pending");

/** The recorded outcome of `promise`, or null when it has not been settled through `settleObservedPromises` yet. */
export const getSettledPromise = (promise: Promise<unknown>): SettledPromise | null => {
  const settled = settledPromises.get(promise);
  if (!settled) unsettledPromises.add(promise);
  return settled ?? null;
};

const observeSettlement = async (promise: Promise<unknown>): Promise<void> => {
  const settlement = promise.then(
    (outcome): SettledPromise => ({ isFulfilled: true, outcome }),
    (outcome: unknown): SettledPromise => ({ isFulfilled: false, outcome }),
  );
  const timeout = new Promise<typeof STILL_PENDING>((resolve) =>
    setTimeout(() => resolve(STILL_PENDING), 0),
  );
  const settled = await Promise.race([settlement, timeout]);
  if (settled !== STILL_PENDING) settledPromises.set(promise, settled);
};

/**
 * A promise's state is not readable synchronously, so the capture runs twice:
 * the first `read` records the promises it met, this settles those that
 * already have (their reactions run before a macrotask), and a second `read`
 * then carries their outcomes. Promises still pending stay opaque.
 */
export const captureWithSettledPromises = async <T>(read: () => Promise<T>): Promise<T> => {
  const first = await read();
  if (unsettledPromises.size === 0) return first;
  const pending = [...unsettledPromises];
  unsettledPromises.clear();
  await Promise.all(pending.map(observeSettlement));
  return read();
};
