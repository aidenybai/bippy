import {
  chainPromise,
  combinePromises,
  escapedPromiseValue,
  getModeledPromise,
  resolvedPromiseValue,
} from "../evaluate/promises.js";
import {
  FALSE_VALUE,
  getObjectProperty,
  getTruthiness,
  isCallable,
  listValue,
  NULL_VALUE,
  objectFromRecord,
  objectValue,
  primitiveValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction } from "../frameworks/stubs.js";
import type {
  LibraryValueProvider,
  ProjectContext,
  StaticListValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";

// Static stand-in for axios (`lib/axios.js`, `lib/core/Axios.js`): the request
// methods build a config, run the request interceptors, then hand the config to
// the adapter, whose response settles outside the analysis; response
// interceptors are its continuations. Everything else the package exports is
// left opaque.

export const AXIOS_PACKAGES = ["axios"];

const METHODS_WITHOUT_DATA = ["delete", "get", "head", "options"];
const METHODS_WITH_DATA = ["post", "put", "patch"];
const METHODS_WITH_DEFAULT_HEADERS = ["delete", "get", "head", "post", "put", "patch"];
const HANDLERS_KEY = "handlers";

interface Interceptor {
  fulfilled: StaticValue | null;
  rejected: StaticValue | null;
  isSynchronous: boolean;
  runWhen: StaticValue | null;
}

interface AxiosInstance {
  defaults: StaticObjectValue;
  requestInterceptors: StaticObjectValue;
  responseInterceptors: StaticObjectValue;
}

const spreadEntry = (value: StaticValue): StaticObjectEntry => ({ kind: "spread", value });

const propertyEntry = (key: string, value: StaticValue): StaticObjectEntry => ({
  kind: "property",
  key,
  value,
});

const readProperty = (object: StaticValue | undefined, key: string): StaticValue =>
  object?.kind === "object" ? getObjectProperty(object, key) : UNDEFINED_VALUE;

const optionalCallable = (value: StaticValue): StaticValue | null =>
  isCallable(value) ? value : null;

/** `lib/defaults/index.js`: the options every instance starts from. */
const createDefaults = (): StaticObjectValue =>
  objectFromRecord({
    adapter: listValue(["xhr", "http", "fetch"].map(primitiveValue)),
    timeout: primitiveValue(0),
    xsrfCookieName: primitiveValue("XSRF-TOKEN"),
    xsrfHeaderName: primitiveValue("X-XSRF-TOKEN"),
    maxContentLength: primitiveValue(-1),
    maxBodyLength: primitiveValue(-1),
    headers: objectFromRecord({
      common: objectFromRecord({
        Accept: primitiveValue("application/json, text/plain, */*"),
        "Content-Type": UNDEFINED_VALUE,
      }),
      ...Object.fromEntries(METHODS_WITH_DEFAULT_HEADERS.map((method) => [method, objectValue()])),
    }),
  });

/** `mergeConfig(defaults, config)`: the later object's options win. */
const mergeConfig = (base: StaticValue, override: StaticValue): StaticObjectValue =>
  objectValue([
    spreadEntry(base),
    spreadEntry(override),
    propertyEntry(
      "headers",
      objectValue([
        spreadEntry(readProperty(base, "headers")),
        spreadEntry(readProperty(override, "headers")),
      ]),
    ),
  ]);

const createInterceptorManager = (): StaticObjectValue =>
  objectFromRecord({ [HANDLERS_KEY]: listValue([]) });

const getHandlers = (manager: StaticObjectValue): StaticListValue => {
  const handlers = getObjectProperty(manager, HANDLERS_KEY);
  return handlers.kind === "list" ? handlers : listValue([]);
};

const readInterceptors = (manager: StaticObjectValue): Interceptor[] =>
  getHandlers(manager).items.flatMap((handler) => {
    if (handler.kind !== "object") return [];
    return [
      {
        fulfilled: optionalCallable(getObjectProperty(handler, "fulfilled")),
        rejected: optionalCallable(getObjectProperty(handler, "rejected")),
        isSynchronous: getTruthiness(getObjectProperty(handler, "synchronous")) === true,
        runWhen: optionalCallable(getObjectProperty(handler, "runWhen")),
      },
    ];
  });

/** `InterceptorManager`: `use` appends a handler and returns its index; `eject`/`clear` remove handlers. */
const interceptorManagerValue = (manager: StaticObjectValue): StaticValue =>
  objectFromRecord({
    use: nativeFunction("use", ([fulfilled, rejected, options], tools) => {
      const handlers = getHandlers(manager);
      tools.pushItems(handlers, [
        objectFromRecord({
          fulfilled: fulfilled ?? UNDEFINED_VALUE,
          rejected: rejected ?? UNDEFINED_VALUE,
          synchronous: options ? readProperty(options, "synchronous") : FALSE_VALUE,
          runWhen: options ? readProperty(options, "runWhen") : NULL_VALUE,
        }),
      ]);
      return primitiveValue(handlers.items.length - 1);
    }),
    eject: nativeFunction("eject", ([id], tools) => {
      if (id?.kind !== "primitive" || typeof id.value !== "number") return UNDEFINED_VALUE;
      const items = getHandlers(manager).items;
      if (items[id.value] === undefined) return UNDEFINED_VALUE;
      tools.setProperty(
        manager,
        HANDLERS_KEY,
        listValue(items.map((item, index) => (index === id.value ? NULL_VALUE : item))),
      );
      return UNDEFINED_VALUE;
    }),
    clear: nativeFunction("clear", (_, tools) => {
      tools.setProperty(manager, HANDLERS_KEY, listValue([]));
      return UNDEFINED_VALUE;
    }),
  });

const thenPromise = (
  promise: StaticValue,
  onFulfilled: StaticValue | null,
  onRejected: StaticValue | null,
  tools: StubRenderTools,
): StaticValue => {
  const modeled = getModeledPromise(promise);
  if (!modeled) return promise;
  return chainPromise(modeled, { onFulfilled, onRejected, onFinally: null }, tools, null);
};

/** `dispatchRequest`: the adapter's response arrives from the network, so the promise settles outside the analysis. */
const dispatchRequest = (): StaticValue => escapedPromiseValue();

/** `Axios.prototype._request`: interceptors around the adapter, chained as promise continuations unless every request interceptor is synchronous. */
const request = (
  instance: AxiosInstance,
  configOrUrl: StaticValue | undefined,
  configArgument: StaticValue | undefined,
  tools: StubRenderTools,
): StaticValue => {
  const isUrl = configOrUrl?.kind === "primitive" && typeof configOrUrl.value === "string";
  const requestConfig = isUrl
    ? objectValue([spreadEntry(configArgument ?? objectValue()), propertyEntry("url", configOrUrl)])
    : (configOrUrl ?? objectValue());
  const config = mergeConfig(instance.defaults, requestConfig);
  const requestChain = readInterceptors(instance.requestInterceptors)
    .filter((interceptor) => {
      if (!interceptor.runWhen) return true;
      const shouldRun = tools.call(interceptor.runWhen, [config]);
      return !(shouldRun.kind === "primitive" && shouldRun.value === false);
    })
    .reverse();
  const responseChain = readInterceptors(instance.responseInterceptors);
  const isSynchronous = requestChain.every((interceptor) => interceptor.isSynchronous);
  let promise: StaticValue;
  if (isSynchronous) {
    let currentConfig: StaticValue = config;
    for (const interceptor of requestChain) {
      if (!interceptor.fulfilled) continue;
      const next = tools.call(interceptor.fulfilled, [currentConfig]);
      if (next.kind === "unknown" && next.thrown !== undefined) {
        if (interceptor.rejected) tools.call(interceptor.rejected, [next.thrown]);
        break;
      }
      currentConfig = next;
    }
    promise = dispatchRequest();
  } else {
    promise = resolvedPromiseValue(config);
    for (const interceptor of requestChain) {
      promise = thenPromise(promise, interceptor.fulfilled, interceptor.rejected, tools);
    }
    promise = thenPromise(promise, nativeFunction("dispatchRequest", dispatchRequest), null, tools);
  }
  for (const interceptor of responseChain) {
    promise = thenPromise(promise, interceptor.fulfilled, interceptor.rejected, tools);
  }
  return promise;
};

const methodConfig = (
  method: string,
  url: StaticValue | undefined,
  data: StaticValue | undefined,
  config: StaticValue | undefined,
): StaticValue =>
  mergeConfig(
    config ?? objectValue(),
    objectFromRecord({
      method: primitiveValue(method),
      url: url ?? UNDEFINED_VALUE,
      data: data ?? UNDEFINED_VALUE,
    }),
  );

/** `createInstance(defaultConfig)`: a bound `request` carrying the `Axios` prototype methods and the context's own properties. */
const createInstance = (defaults: StaticObjectValue): StaticValue => {
  const instance: AxiosInstance = {
    defaults,
    requestInterceptors: createInterceptorManager(),
    responseInterceptors: createInterceptorManager(),
  };
  const properties = new Map<string, StaticValue>([
    ["defaults", defaults],
    [
      "interceptors",
      objectFromRecord({
        request: interceptorManagerValue(instance.requestInterceptors),
        response: interceptorManagerValue(instance.responseInterceptors),
      }),
    ],
    [
      "request",
      nativeFunction("request", ([configOrUrl, config], tools) =>
        request(instance, configOrUrl, config, tools),
      ),
    ],
    [
      "create",
      nativeFunction("create", ([instanceConfig]) =>
        createInstance(mergeConfig(defaults, instanceConfig ?? objectValue())),
      ),
    ],
    ...METHODS_WITHOUT_DATA.map((method): [string, StaticValue] => [
      method,
      nativeFunction(method, ([url, config], tools) =>
        request(
          instance,
          methodConfig(method, url, readProperty(config, "data"), config),
          undefined,
          tools,
        ),
      ),
    ]),
    ...METHODS_WITH_DATA.flatMap((method): [string, StaticValue][] =>
      [method, `${method}Form`].map((name): [string, StaticValue] => [
        name,
        nativeFunction(name, ([url, data, config], tools) =>
          request(instance, methodConfig(method, url, data, config), undefined, tools),
        ),
      ]),
    ),
  ]);
  return {
    kind: "native-function",
    name: "axios",
    call: ([configOrUrl, config], tools) => request(instance, configOrUrl, config, tools),
    getOwnProperty: (key) => properties.get(key),
  };
};

const defaultInstances = new WeakMap<ProjectContext, StaticValue>();

const getDefaultInstance = (project: ProjectContext): StaticValue => {
  let instance = defaultInstances.get(project);
  if (!instance) {
    instance = createInstance(createDefaults());
    defaultInstances.set(project, instance);
  }
  return instance;
};

const externalExport = (importedName: string): StaticValue => ({
  kind: "external",
  packageName: "axios",
  importedName,
  origin: "binding",
});

const isCancel = (): StaticValue =>
  nativeFunction("isCancel", ([value]) => {
    if (!value) return FALSE_VALUE;
    const truthiness = getTruthiness(value);
    if (truthiness === false) return FALSE_VALUE;
    const marker = readProperty(value, "__CANCEL__");
    const isCanceled = getTruthiness(marker);
    return isCanceled === null
      ? unknownValue("whether the value is a cancellation")
      : isCanceled
        ? TRUE_VALUE
        : FALSE_VALUE;
  });

const isAxiosError = (): StaticValue =>
  nativeFunction("isAxiosError", ([payload]) => {
    if (!payload) return FALSE_VALUE;
    if (payload.kind === "primitive") return FALSE_VALUE;
    const marker = readProperty(payload, "isAxiosError");
    if (marker.kind === "primitive") return marker.value === true ? TRUE_VALUE : FALSE_VALUE;
    return unknownValue("whether the value is an axios error");
  });

const all = (): StaticValue =>
  nativeFunction("all", ([promises], tools) =>
    promises?.kind === "list"
      ? combinePromises(promises.items, tools, null)
      : unknownValue("Promise.all of an unknown list"),
  );

const spread = (): StaticValue =>
  nativeFunction("spread", ([callback]) =>
    nativeFunction("wrap", ([items], tools) =>
      callback && items?.kind === "list"
        ? tools.call(callback, items.items)
        : unknownValue("spread over an unknown list"),
    ),
  );

const staticExports = new Map<string, () => StaticValue>([
  ["isCancel", isCancel],
  ["isAxiosError", isAxiosError],
  ["all", all],
  ["spread", spread],
]);

export const axiosValue: LibraryValueProvider = (specifier, importedName, project) => {
  if (specifier !== "axios") return null;
  const defaultInstance = getDefaultInstance(project);
  const getExport = (name: string): StaticValue => {
    if (name === "default") return defaultInstance;
    if (name === "VERSION") {
      const version = project.readPackageVersion("axios");
      return version ? primitiveValue(version) : externalExport(name);
    }
    const modeled = staticExports.get(name);
    return modeled ? modeled() : externalExport(name);
  };
  if (importedName !== "*") return getExport(importedName);
  return {
    kind: "native-function",
    name: "axios",
    call: (args, tools) => tools.call(defaultInstance, args),
    getOwnProperty: getExport,
  };
};
