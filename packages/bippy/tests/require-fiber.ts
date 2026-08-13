import type { Fiber } from "../src/react-internals/index.js";

export const requireFiber = (value: Fiber | null | undefined, message: string): Fiber => {
  if (value === null || value === undefined) throw new Error(message);
  return value;
};
