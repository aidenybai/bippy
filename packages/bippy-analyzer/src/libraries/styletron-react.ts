import { element, nativeFunction, stubValue } from "../evaluate/stubs.js";
import {
  UNDEFINED_VALUE,
  branchValue,
  getObjectProperty,
  getTruthiness,
  isFunctionValue,
  mapValue,
  objectValue,
  unknownPrimitiveValue,
} from "../evaluate/values.js";
import { toElementType } from "../react/element-type.js";
import type {
  LibraryValueProvider,
  ModeledExports,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubComponent,
} from "../types.js";
import { ForwardRefTag } from "../work-tags.js";

export const STYLETRON_REACT_PACKAGES = ["styletron-react"];

export const STYLETRON_REACT_MODELED_EXPORTS: ModeledExports = {
  "styletron-react": ["createStyled"],
};

const firstTruthy = (value: StaticValue, fallback: StaticValue): StaticValue =>
  mapValue(value, (alternative) => {
    const truthiness = getTruthiness(alternative);
    if (truthiness === true) return alternative;
    if (truthiness === false) return fallback;
    return branchValue([alternative, fallback], "Styletron $as prop", null, 1);
  });

const getForwardedProps = (props: StaticObjectValue): StaticObjectEntry[] =>
  props.entries.flatMap((entry): StaticObjectEntry[] => {
    if (entry.kind === "spread") {
      return entry.value.kind === "object" ? getForwardedProps(entry.value) : [entry];
    }
    return entry.key.startsWith("$") ? [] : [entry];
  });

const createStyledComponent = (base: StaticValue): StaticValue => {
  const stub: StubComponent = {
    displayName: null,
    tag: ForwardRefTag,
    render: (props) =>
      mapValue(firstTruthy(getObjectProperty(props, "$as"), base), (target) => {
        const entries = getForwardedProps(props);
        entries.push({
          kind: "property",
          key: "className",
          value: unknownPrimitiveValue("string", "Styletron class name"),
        });
        return element(toElementType(target, null), objectValue(entries));
      }),
  };
  return stubValue(stub);
};

const createStyled = (options: StaticValue): StaticValue => {
  const wrapper =
    options.kind === "object" ? getObjectProperty(options, "wrapper") : UNDEFINED_VALUE;
  return nativeFunction("styled", ([base = UNDEFINED_VALUE], tools) => {
    const component = createStyledComponent(base);
    return isFunctionValue(wrapper) ? tools.call(wrapper, [component]) : component;
  });
};

export const styletronReactValue: LibraryValueProvider = (specifier, importedName) => {
  if (specifier !== "styletron-react" || importedName !== "createStyled") return null;
  return nativeFunction("createStyled", ([options = UNDEFINED_VALUE]) => createStyled(options));
};
