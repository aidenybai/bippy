import type { Unsubscribe } from "bippy";

export const createUnsubscribe = (unsubscribe: () => void): Unsubscribe =>
  Object.assign(unsubscribe, { [Symbol.dispose]: unsubscribe });
