import { element, stubValue } from "../evaluate/stubs.js";
import { getObjectProperty, objectFromRecord } from "../evaluate/values.js";
import type {
  ContextDefinition,
  LibraryValueProvider,
  ModeledExports,
  StubComponent,
} from "../types.js";

export const RADIX_UI_PACKAGES = ["@radix-ui/react-tooltip"];
export const RADIX_UI_MODELED_EXPORTS: ModeledExports = {
  "@radix-ui/react-tooltip": ["Provider"],
};

const TOOLTIP_PROVIDER_CONTEXT: ContextDefinition = {
  name: "TooltipProvider",
  displayName: null,
  defaultValue: objectFromRecord({}),
  location: null,
};

const TOOLTIP_CONTEXT_PROVIDER_STUB: StubComponent = {
  displayName: "TooltipProvider",
  render: (props) =>
    element(
      { kind: "context-provider", context: TOOLTIP_PROVIDER_CONTEXT, displayName: null },
      objectFromRecord({
        value: objectFromRecord({}),
        children: getObjectProperty(props, "children"),
      }),
    ),
};

const TOOLTIP_PROVIDER_STUB: StubComponent = {
  displayName: "TooltipProvider",
  render: (props) => element({ kind: "stub", stub: TOOLTIP_CONTEXT_PROVIDER_STUB }, props),
};

export const radixUiValue: LibraryValueProvider = (specifier, importedName) =>
  specifier === "@radix-ui/react-tooltip" && importedName === "Provider"
    ? stubValue(TOOLTIP_PROVIDER_STUB)
    : null;
