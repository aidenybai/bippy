import { resolvedPromiseValue } from "../evaluate/promises.js";
import { nativeFunction } from "../evaluate/stubs.js";
import { objectFromRecord, unknownValue } from "../evaluate/values.js";
import type { LibraryValueProvider, ModeledExports, StaticValue } from "../types.js";

export const APOLLO_NEXTJS_PACKAGES = ["@apollo/experimental-nextjs-app-support"];
export const APOLLO_NEXTJS_MODELED_EXPORTS: ModeledExports = {
  "@apollo/experimental-nextjs-app-support": ["registerApolloClient"],
};

const APOLLO_RESULT = objectFromRecord({
  data: unknownValue("data returned by an Apollo operation"),
  error: unknownValue("error returned by an Apollo operation"),
});

const APOLLO_CLIENT = objectFromRecord({
  query: nativeFunction("query", () => resolvedPromiseValue(APOLLO_RESULT)),
  mutate: nativeFunction("mutate", () => resolvedPromiseValue(APOLLO_RESULT)),
});

const registerApolloClient = (): StaticValue =>
  nativeFunction("registerApolloClient", () =>
    objectFromRecord({
      getClient: nativeFunction("getClient", () => APOLLO_CLIENT),
    }),
  );

export const apolloNextjsValue: LibraryValueProvider = (specifier, importedName) =>
  specifier === "@apollo/experimental-nextjs-app-support" &&
  importedName === "registerApolloClient"
    ? registerApolloClient()
    : null;
