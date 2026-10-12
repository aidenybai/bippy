// HACK: a mount has no request; values are awaitable because Next 15 made these async.
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
