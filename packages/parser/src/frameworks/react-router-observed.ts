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
import type { CapturedFetcher, CapturedRouterState, StaticValue } from "../types.js";

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
  /** `useFetchers()`: the fetchers that had loaded or submitted. */
  fetchers: StaticValue;
  /**
   * `useFetcher()`'s own state: idle while no fetcher had been used, since a
   * fetcher keyed by `useId` cannot be told apart from the captured ones.
   */
  fetcher: StaticValue;
  /** `HydratedRouter` re-renders after hydration only to drop dev-server critical CSS. */
  hasCriticalCss: boolean | null;
}

const SUBMISSION_FIELDS = ["formMethod", "formAction", "formEncType", "formData", "json", "text"];

const undefinedFields = (fields: string[]): Record<string, StaticValue> =>
  Object.fromEntries(fields.map((field) => [field, UNDEFINED_VALUE]));

const idleNavigation = (): StaticValue =>
  objectFromRecord({
    state: primitiveValue("idle"),
    ...undefinedFields(["location", ...SUBMISSION_FIELDS]),
  });

const idleFetcher = (): StaticValue =>
  objectFromRecord({
    state: primitiveValue("idle"),
    ...undefinedFields(["data", ...SUBMISSION_FIELDS]),
  });

const optionalString = (value: string | undefined): StaticValue =>
  value === undefined ? UNDEFINED_VALUE : primitiveValue(value);

const capturedFetcher = (fetcher: CapturedFetcher): StaticValue =>
  objectFromRecord({
    key: primitiveValue(fetcher.key),
    state: primitiveValue(fetcher.state),
    formMethod: optionalString(fetcher.formMethod),
    formAction: optionalString(fetcher.formAction),
    formEncType: optionalString(fetcher.formEncType),
    formData: unknownValue(`FormData of fetcher ${fetcher.key} is not captured`),
    json: unknownValue(`JSON body of fetcher ${fetcher.key} is not captured`),
    text: unknownValue(`text body of fetcher ${fetcher.key} is not captured`),
    data:
      fetcher.data === undefined
        ? UNDEFINED_VALUE
        : capturedValue(fetcher.data, `fetcher ${fetcher.key} data`),
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
    fetchers: state.fetchers
      ? listValue(state.fetchers.map(capturedFetcher))
      : unknownValue("react-router fetchers were not captured"),
    fetcher:
      state.fetchers?.length === 0
        ? idleFetcher()
        : unknownValue("react-router fetcher state is only known at runtime"),
    hasCriticalCss: state.hasCriticalCss ?? null,
  };
};
