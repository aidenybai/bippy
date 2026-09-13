import isPropValid from "@emotion/is-prop-valid";
import {
  UNDEFINED_VALUE,
  getObjectProperty,
  getTruthiness,
  mapValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { element, nativeFunction, stubValue } from "../evaluate/stubs.js";
import { toElementType } from "../react/element-type.js";
import type {
  LibraryValueProvider,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubComponent,
} from "../types.js";
import { ForwardRefTag } from "../work-tags.js";

// Linaria's styles are extracted at build time: wyw-in-js rewrites
// `styled.div`...`` into `styled("div")({ name, class, propsAsIs, vars })`, so
// the template form only exists in the source the analysis reads while the
// running app has the call form. Both produce the same `forwardRef` component:
// it renders its tag (or the `as` prop) with the props that survive
// `@emotion/is-prop-valid` on plain host tags, and styling a styled component
// renders the parent styled component with `as` pointing at the requested tag.
// The class names are hashes only the build can produce.

export const LINARIA_PACKAGES = ["@linaria/react", "@linaria/core"];

interface LinariaStyled {
  tag: StaticValue;
}

const STYLED_COMPONENTS = new WeakMap<StubComponent, LinariaStyled>();

const classNameValue = (): StaticValue => unknownPrimitiveValue("string", "linaria class name");

const isLinariaStyled = (value: StaticValue): boolean =>
  value.kind === "component-reference" &&
  value.type.kind === "stub" &&
  STYLED_COMPONENTS.has(value.type.stub);

const getOption = (options: StaticValue, key: string): StaticValue =>
  options.kind === "object" ? getObjectProperty(options, key) : UNDEFINED_VALUE;

const isPlainHostTag = (component: StaticValue): boolean =>
  component.kind === "primitive" &&
  typeof component.value === "string" &&
  !component.value.includes("-") &&
  /^[^A-Z]/.test(component.value);

/** `propsAsIs ?? !(plain lowercase host tag)`; null when the option is not statically known. */
const keepsPropsAsIs = (options: StaticValue, component: StaticValue): boolean | null => {
  const propsAsIs = getOption(options, "propsAsIs");
  if (propsAsIs.kind === "primitive" && propsAsIs.value === undefined) {
    return !isPlainHostTag(component);
  }
  return getTruthiness(propsAsIs);
};

const OMITTED_PROPS = new Set(["as", "class"]);

const forwardedProps = (props: StaticObjectValue, keepsAsIs: boolean | null): StaticObjectEntry[] =>
  props.entries.flatMap((entry) => {
    if (entry.kind === "spread") {
      return entry.value.kind === "object" ? forwardedProps(entry.value, keepsAsIs) : [entry];
    }
    if (OMITTED_PROPS.has(entry.key)) return [];
    return keepsAsIs !== false || entry.key === "ref" || isPropValid(entry.key) ? [entry] : [];
  });

const componentFor = (asValue: StaticValue, tag: StaticValue): StaticValue =>
  mapValue(asValue, (alternative) =>
    alternative.kind === "primitive" && alternative.value === undefined ? tag : alternative,
  );

const createStyled = (tag: StaticValue, options: StaticValue, name: string | null): StaticValue => {
  const stub: StubComponent = {
    displayName: name,
    tag: ForwardRefTag,
    properties: new Map([
      ["__wyw_meta", objectFromRecord({ className: classNameValue(), extends: tag })],
    ]),
    render: (props) =>
      mapValue(componentFor(getObjectProperty(props, "as"), tag), (component) => {
        const entries = forwardedProps(props, keepsPropsAsIs(options, component));
        entries.push({ kind: "property", key: "className", value: classNameValue() });
        if (isLinariaStyled(tag) && component !== tag) {
          entries.push({ kind: "property", key: "as", value: component });
          return element(toElementType(tag, null), objectValue(entries));
        }
        return element(toElementType(component, null), objectValue(entries));
      }),
  };
  STYLED_COMPONENTS.set(stub, { tag });
  return stubValue(stub);
};

const getStringOption = (options: StaticValue, key: string): string | null => {
  const value = getOption(options, key);
  return value.kind === "primitive" && typeof value.value === "string" ? value.value : null;
};

/** `styled(tag)`: the template form names the component after its binding as wyw-in-js does. */
const styledFactory = (tag: StaticValue): StaticValue =>
  nativeFunction("styled", ([options = UNDEFINED_VALUE], tools) =>
    createStyled(
      tag,
      options,
      options.kind === "object" ? getStringOption(options, "name") : tools.nameHint,
    ),
  );

const styledValue = (): StaticValue => ({
  kind: "proxy",
  target: nativeFunction("styled", ([tag = UNDEFINED_VALUE]) => styledFactory(tag)),
  handler: objectFromRecord({
    get: nativeFunction("styled.<tag>", ([, key]) =>
      key?.kind === "primitive" && typeof key.value === "string"
        ? styledFactory(primitiveValue(key.value))
        : unknownValue("styled tag name"),
    ),
  }),
});

export const linariaValue: LibraryValueProvider = (specifier, importedName) => {
  if (specifier === "@linaria/react" && importedName === "styled") return styledValue();
  if (specifier === "@linaria/core" && (importedName === "css" || importedName === "cx")) {
    return nativeFunction(importedName, classNameValue);
  }
  return null;
};
