import { element, stubValue } from "../evaluate/stubs.js";
import { getObjectProperty, objectFromRecord, unknownValue } from "../evaluate/values.js";
import type {
  ContextDefinition,
  LibraryValueProvider,
  ModeledExports,
  StubComponent,
} from "../types.js";

export const NEXT_AUTH_PACKAGES = ["next-auth"];
export const NEXT_AUTH_MODELED_EXPORTS: ModeledExports = {
  "next-auth/react": ["SessionProvider"],
};

const SESSION_CONTEXT: ContextDefinition = {
  name: "SessionContext",
  displayName: null,
  defaultValue: unknownValue("next-auth session"),
  location: null,
};

const SESSION_PROVIDER_STUB: StubComponent = {
  displayName: "SessionProvider",
  render: (props) =>
    element(
      { kind: "context-provider", context: SESSION_CONTEXT, displayName: null },
      objectFromRecord({
        value: unknownValue("next-auth session"),
        children: getObjectProperty(props, "children"),
      }),
    ),
};

export const nextAuthValue: LibraryValueProvider = (specifier, importedName) =>
  specifier === "next-auth/react" && importedName === "SessionProvider"
    ? stubValue(SESSION_PROVIDER_STUB)
    : null;
