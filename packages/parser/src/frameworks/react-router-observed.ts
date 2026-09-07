import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  capturedValue,
  listValue,
  objectFromRecord,
  primitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { createSearchParamsValue } from "../evaluate/url-search-params.js";
import type { CapturedRouterState, StaticValue } from "../types.js";

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
    searchParams: createSearchParamsValue(primitiveValue(state.location.search)),
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
