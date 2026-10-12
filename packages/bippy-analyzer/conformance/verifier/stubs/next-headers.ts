/**
 * Stands in for `next/headers`, which reads the request a server component renders for.
 * A mount has no request: no cookies, no headers and no draft mode. Next 15 makes these
 * async, so each value also works when awaited.
 */
const cookieStore = {
  get: () => undefined,
  getAll: () => [],
  has: () => false,
  set: () => undefined,
  delete: () => undefined,
};

const requestHeaders = new Headers();
const headerReader = {
  get: (name: string) => requestHeaders.get(name),
  has: (name: string) => requestHeaders.has(name),
  entries: () => requestHeaders.entries(),
  keys: () => requestHeaders.keys(),
  values: () => requestHeaders.values(),
  forEach: (callback: (value: string, key: string) => void) => requestHeaders.forEach(callback),
};

const draftModeState = { isEnabled: false, enable: () => undefined, disable: () => undefined };

const asAwaitable = <Value extends object>(value: Value): Value & Promise<Value> =>
  Object.assign(Promise.resolve(value), value);

export const cookies = () => asAwaitable(cookieStore);
export const headers = () => asAwaitable(headerReader);
export const draftMode = () => asAwaitable(draftModeState);
