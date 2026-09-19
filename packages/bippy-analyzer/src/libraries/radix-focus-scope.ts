import { element, omitProps, stubValue } from "../evaluate/stubs.js";
import {
  getObjectProperty,
  getTruthiness,
  objectValue,
  primitiveValue,
} from "../evaluate/values.js";
import type {
  LibraryValueProvider,
  ModeledExports,
  StubComponent,
} from "../types.js";
import { ForwardRefTag } from "../work-tags.js";

export const RADIX_FOCUS_SCOPE_PACKAGES = ["@radix-ui/react-focus-scope"];

const [PACKAGE_NAME] = RADIX_FOCUS_SCOPE_PACKAGES;
const FOCUS_PROPS = new Set(["loop", "trapped", "onMountAutoFocus", "onUnmountAutoFocus"]);
const AS_CHILD_PROP = new Set(["asChild"]);

const slotClone: StubComponent = {
  displayName: "Primitive.div.SlotClone",
  tag: ForwardRefTag,
  render: (props) => getObjectProperty(props, "children"),
};

const slot: StubComponent = {
  displayName: "Primitive.div.Slot",
  tag: ForwardRefTag,
  render: (props) => element({ kind: "stub", stub: slotClone }, props),
};

const primitiveDiv: StubComponent = {
  displayName: "Primitive.div",
  tag: ForwardRefTag,
  render: (props) =>
    getTruthiness(getObjectProperty(props, "asChild")) === true
      ? element({ kind: "stub", stub: slot }, omitProps(props, AS_CHILD_PROP))
      : element({ kind: "host", tagName: "div" }, omitProps(props, AS_CHILD_PROP)),
};

const focusScope: StubComponent = {
  displayName: "FocusScope",
  tag: ForwardRefTag,
  render: (props) =>
    element(
      { kind: "stub", stub: primitiveDiv },
      objectValue([
        { kind: "property", key: "tabIndex", value: primitiveValue(-1) },
        { kind: "spread", value: omitProps(props, FOCUS_PROPS) },
      ]),
    ),
};

const focusScopeValue = stubValue(focusScope);

export const RADIX_FOCUS_SCOPE_MODELED_EXPORTS: ModeledExports = {
  [PACKAGE_NAME]: ["FocusScope", "Root"],
};

export const radixFocusScopeValue: LibraryValueProvider = (specifier, importedName) =>
  specifier === PACKAGE_NAME && (importedName === "FocusScope" || importedName === "Root")
    ? focusScopeValue
    : null;
