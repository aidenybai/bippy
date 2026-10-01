import { element, nativeFunction, stubValue } from "../evaluate/stubs.js";
import {
  getObjectProperty,
  objectFromRecord,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import type {
  ContextDefinition,
  LibraryValueProvider,
  ModeledExports,
  StubComponent,
} from "../types.js";

export const NEXT_AUTH_PACKAGES = ["next-auth"];
export const NEXT_AUTH_MODELED_EXPORTS: ModeledExports = {
  "next-auth/react": ["SessionProvider", "useSession"],
};

const SESSION_VALUE = objectFromRecord({
  data: unknownValue("next-auth session data"),
  status: unknownPrimitiveValue("string", "next-auth session status"),
  update: nativeFunction("update", () => unknownValue("next-auth session update promise")),
});

const SESSION_CONTEXT: ContextDefinition = {
  name: "SessionContext",
  displayName: null,
  defaultValue: SESSION_VALUE,
  location: null,
};

const SESSION_PROVIDER_STUB: StubComponent = {
  displayName: "SessionProvider",
  render: (props) =>
    element(
      { kind: "context-provider", context: SESSION_CONTEXT, displayName: null },
      objectFromRecord({
        value: SESSION_VALUE,
        children: getObjectProperty(props, "children"),
      }),
    ),
};

export const nextAuthValue: LibraryValueProvider = (specifier, importedName) => {
  if (specifier !== "next-auth/react") return null;
  if (importedName === "SessionProvider") return stubValue(SESSION_PROVIDER_STUB);
  if (importedName === "useSession") {
    return nativeFunction("useSession", (_args, tools) => tools.readContext(SESSION_CONTEXT));
  }
  return null;
};
