import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  capturedValue,
  listValue,
  objectFromRecord,
  primitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import type { CapturedRouterState, StaticValue } from "../types.js";
import { nativeFunction } from "./stubs.js";

/**
 * The data router's state as the page had it, replayed into the hooks that
 * read it. Only used when the capture is of the URL being rendered; anything
 * a navigation in flight would change stays unknown.
 */
export interface ObservedRouterState {
  location: StaticValue;
  navigation: StaticValue;
  revalidation: StaticValue;
  searchParams: StaticValue;
  matches: StaticValue;
  loaderData: (routeId: string) => StaticValue;
}

const IDLE_NAVIGATION_FIELDS = [
  "location",
  "formMethod",
  "formAction",
  "formEncType",
  "formData",
  "json",
  "text",
];

const idleNavigation = (): StaticValue =>
  objectFromRecord({
    state: primitiveValue("idle"),
    ...Object.fromEntries(IDLE_NAVIGATION_FIELDS.map((field) => [field, UNDEFINED_VALUE])),
  });

const stringRecordValue = (record: Record<string, string>): StaticValue =>
  objectFromRecord(
    Object.fromEntries(Object.entries(record).map(([key, value]) => [key, primitiveValue(value)])),
  );

const stringOrNull = (value: string | null | undefined): StaticValue =>
  value === null || value === undefined ? NULL_VALUE : primitiveValue(value);

/** A `URLSearchParams` over a known query string, read-only as `useSearchParams` hands it out. */
const searchParamsValue = (search: string): StaticValue => {
  const params = new URLSearchParams(search);
  const readKey = (args: StaticValue[]): string | null => {
    const [key] = args;
    return key?.kind === "primitive" && typeof key.value === "string" ? key.value : null;
  };
  const withKey = (name: string, read: (key: string) => StaticValue): StaticValue =>
    nativeFunction(name, (args) => {
      const key = readKey(args);
      return key === null
        ? unknownValue(`URLSearchParams.${name}() with a dynamic key`)
        : read(key);
    });
  return objectFromRecord({
    get: withKey("get", (key) => stringOrNull(params.get(key))),
    getAll: withKey("getAll", (key) => listValue(params.getAll(key).map(primitiveValue))),
    has: withKey("has", (key) => primitiveValue(params.has(key))),
    size: primitiveValue(params.size),
    toString: nativeFunction("toString", () => primitiveValue(params.toString())),
    entries: nativeFunction("entries", () =>
      listValue(
        [...params.entries()].map(([key, value]) =>
          listValue([primitiveValue(key), primitiveValue(value)]),
        ),
      ),
    ),
    keys: nativeFunction("keys", () => listValue([...params.keys()].map(primitiveValue))),
    values: nativeFunction("values", () => listValue([...params.values()].map(primitiveValue))),
  });
};

export const observeRouterState = (
  state: CapturedRouterState | null,
  pathname: string,
): ObservedRouterState | null => {
  if (!state || state.location.pathname !== pathname) return null;
  const loaderData = (routeId: string): StaticValue =>
    routeId in state.loaderData
      ? capturedValue(state.loaderData[routeId], `loaderData[${routeId}]`)
      : UNDEFINED_VALUE;
  return {
    location: objectFromRecord({
      pathname: primitiveValue(pathname),
      search: primitiveValue(state.location.search),
      hash: primitiveValue(state.location.hash),
      state: NULL_VALUE,
      key: unknownValue("location key is assigned at runtime"),
    }),
    navigation:
      state.navigationState === "idle"
        ? idleNavigation()
        : unknownValue(`react-router navigation is ${state.navigationState}`),
    revalidation: primitiveValue(state.revalidationState),
    searchParams: searchParamsValue(state.location.search),
    matches: listValue(
      state.matches.map((match) =>
        objectFromRecord({
          id: primitiveValue(match.id),
          pathname: primitiveValue(match.pathname),
          params: stringRecordValue(match.params),
          data: loaderData(match.id),
          loaderData: loaderData(match.id),
          handle: unknownValue(`handle export of route ${match.id}`),
        }),
      ),
    ),
    loaderData,
  };
};
