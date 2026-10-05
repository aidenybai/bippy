/** @internal */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function callCallback<T extends any[]>(set: Set<(...args: T) => void>, ...args: T): void {
  for (const callback of set) {
    callback(...args);
  }
}
