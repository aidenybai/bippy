import {
  UNDEFINED_VALUE,
  branchValue,
  getObjectProperty,
  getTruthiness,
  listValue,
  mapValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
} from "../evaluate/values.js";
import { element, lazyProperties, nativeFunction, stubValue } from "../frameworks/stubs.js";
import { toElementType } from "../react/element-type.js";
import type {
  ContextDefinition,
  LibraryValueProvider,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";
import { ForwardRefTag } from "../work-tags.js";
import { describeTag } from "./component-name.js";

// styled-components 5/6's fiber-visible surface (`models/StyledComponent`). A
// styled component is a `forwardRef` named `styled.<tag>` / `Styled(<name>)`
// (or `withConfig({ displayName })`) rendering exactly one element: `$as`/`as`
// or its target, with the resolved `attrs` merged over the props and transient
// (`$`-prefixed) props dropped unless a `shouldForwardProp` decides. Styling a
// styled component folds onto its target and attrs. `ThemeProvider` merges into
// a nameless context; `createGlobalStyle` renders nothing. The package ships
// minified, so React reports its own components (`ThemeProvider`, a global
// style's memo) under minifier names the analysis cannot know.

export const STYLED_COMPONENTS_PACKAGES = ["styled-components"];

const THEME_CONTEXT: ContextDefinition = {
  name: "ThemeContext",
  displayName: null,
  defaultValue: UNDEFINED_VALUE,
  location: null,
};

interface StyledOptions {
  attrs: readonly StaticValue[];
  shouldForwardProp: StaticValue | null;
  displayName: string | null;
}

const DEFAULT_OPTIONS: StyledOptions = { attrs: [], shouldForwardProp: null, displayName: null };

interface StyledComponent {
  /** The host tag or component the whole styled chain renders. */
  target: StaticValue;
  attrs: readonly StaticValue[];
  /** `shouldForwardProp` filters composed along the chain (all must agree); null means the default. */
  propFilters: readonly StaticValue[] | null;
}

const STYLED_COMPONENTS = new WeakMap<StubComponent, StyledComponent>();

const getStyledComponent = (tag: StaticValue): StyledComponent | undefined =>
  tag.kind === "component-reference" && tag.type.kind === "stub"
    ? STYLED_COMPONENTS.get(tag.type.stub)
    : undefined;

const isFunctionLike = (value: StaticValue): boolean =>
  value.kind === "function" || value.kind === "native-function";

const getHostTagName = (target: StaticValue): string | null =>
  target.kind === "primitive" && typeof target.value === "string" ? target.value : null;

/** `isTag`: a string whose first character is not upper case. */
const isTag = (target: StaticValue): boolean => {
  const tagName = getHostTagName(target);
  return tagName !== null && tagName.charAt(0) === tagName.charAt(0).toLowerCase();
};

const generateDisplayName = (target: StaticValue): string =>
  isTag(target) ? `styled.${getHostTagName(target)}` : `Styled(${describeTag(target)})`;

const classNameValue = (): StaticValue =>
  unknownPrimitiveValue("string", "styled-components class name");

/**
 * `a || b || ...`: the first truthy value, branching where a truthiness is not
 * statically known and preferring the concrete alternative over a value the
 * analysis knows nothing about (an `as` hiding in a spread of an unknown object).
 */
const firstTruthy = (values: readonly StaticValue[], reason: string): StaticValue => {
  const [head, ...rest] = values;
  if (head === undefined) return UNDEFINED_VALUE;
  if (rest.length === 0) return head;
  return mapValue(head, (alternative) => {
    const truthiness = getTruthiness(alternative);
    if (truthiness === true) return alternative;
    if (truthiness === false) return firstTruthy(rest, reason);
    return branchValue(
      [alternative, firstTruthy(rest, reason)],
      reason,
      null,
      alternative.kind === "unknown" ? 1 : 0,
    );
  });
};

/** `useResolvedAttrs`: each attr (object or function of `{ ...props, theme, ...earlier attrs }`) layered over the previous. */
const resolveAttrs = (
  props: StaticObjectValue,
  theme: StaticValue,
  attrs: readonly StaticValue[],
  tools: StubRenderTools,
): StaticObjectEntry[] => {
  const resolved: StaticObjectEntry[] = [];
  for (const attr of attrs) {
    const context = objectValue([
      { kind: "spread", value: props },
      { kind: "property", key: "theme", value: theme },
      ...resolved,
    ]);
    resolved.push({
      kind: "spread",
      value: isFunctionLike(attr) ? tools.call(attr, [context]) : attr,
    });
  }
  return resolved;
};

/** null when a user filter's verdict is not statically known. */
const forwardsProp = (
  filters: readonly StaticValue[] | null,
  finalTag: StaticValue,
  key: string,
  tools: StubRenderTools,
): boolean | null => {
  if (filters === null) return true;
  let isUnknown = false;
  for (const filter of filters) {
    const verdict = getTruthiness(tools.call(filter, [primitiveValue(key), finalTag]));
    if (verdict === false) return false;
    if (verdict === null) isUnknown = true;
  }
  return isUnknown ? null : true;
};

const forwardedProps = (
  props: StaticObjectValue,
  finalTag: StaticValue,
  filters: readonly StaticValue[] | null,
  tools: StubRenderTools,
): StaticObjectEntry[] => {
  const entries: StaticObjectEntry[] = [];
  for (const entry of props.entries) {
    if (entry.kind === "spread") {
      if (entry.value.kind === "object") {
        entries.push(...forwardedProps(entry.value, finalTag, filters, tools));
      } else {
        entries.push(entry);
      }
      continue;
    }
    if (entry.key.startsWith("$") || entry.key === "as") continue;
    if (entry.key === "forwardedAs") {
      entries.push({ kind: "property", key: "as", value: entry.value });
    } else if (entry.key === "ref" || forwardsProp(filters, finalTag, entry.key, tools) !== false) {
      entries.push(entry);
    }
  }
  return entries;
};

const composePropFilters = (
  styledTarget: StyledComponent | undefined,
  filter: StaticValue | null,
): readonly StaticValue[] | null => {
  if (filter === null) return styledTarget ? styledTarget.propFilters : null;
  return styledTarget?.propFilters ? [...styledTarget.propFilters, filter] : [filter];
};

/** `createStyledComponent(target, options, rules)`: the rules only produce class names. */
const createStyledComponent = (target: StaticValue, options: StyledOptions): StaticValue => {
  const styledTarget = getStyledComponent(target);
  const styled: StyledComponent = {
    target: styledTarget ? styledTarget.target : target,
    attrs: [...(styledTarget?.attrs ?? []), ...options.attrs],
    propFilters: composePropFilters(styledTarget, options.shouldForwardProp),
  };
  const stub: StubComponent = {
    displayName: options.displayName ?? generateDisplayName(target),
    tag: ForwardRefTag,
    render: (props, tools) => {
      const theme = firstTruthy(
        [getObjectProperty(props, "theme"), tools.readContext(THEME_CONTEXT)],
        "the theme prop's truthiness is not statically known",
      );
      const computedProps = objectValue([
        { kind: "spread", value: props },
        ...resolveAttrs(props, theme, styled.attrs, tools),
      ]);
      const elementToBeCreated = firstTruthy(
        [
          getObjectProperty(computedProps, "$as"),
          getObjectProperty(computedProps, "as"),
          styled.target,
        ],
        "the `as` prop's truthiness is not statically known",
      );
      return mapValue(elementToBeCreated, (finalTag) => {
        const entries = forwardedProps(computedProps, finalTag, styled.propFilters, tools);
        entries.push({ kind: "property", key: "className", value: classNameValue() });
        return element(toElementType(finalTag, null), objectValue(entries));
      });
    },
  };
  STYLED_COMPONENTS.set(stub, styled);
  return stubValue(stub);
};

const readConfig = (options: StyledOptions, config: StaticValue): StyledOptions => {
  if (config.kind !== "object") return options;
  const filter = getObjectProperty(config, "shouldForwardProp");
  const displayName = getObjectProperty(config, "displayName");
  return {
    attrs: options.attrs,
    shouldForwardProp: isFunctionLike(filter) ? filter : options.shouldForwardProp,
    displayName:
      displayName.kind === "primitive" && typeof displayName.value === "string"
        ? displayName.value
        : options.displayName,
  };
};

/** `constructWithOptions`: a template function carrying `.withConfig()` and `.attrs()`. */
const constructWithOptions = (target: StaticValue, options: StyledOptions): StaticValue =>
  lazyProperties(
    nativeFunction("styled", () => createStyledComponent(target, options)),
    (key) => {
      switch (key) {
        case "withConfig":
          return nativeFunction("withConfig", ([config = UNDEFINED_VALUE]) =>
            constructWithOptions(target, readConfig(options, config)),
          );
        case "attrs":
          return nativeFunction("attrs", ([attr = UNDEFINED_VALUE]) =>
            constructWithOptions(target, { ...options, attrs: [...options.attrs, attr] }),
          );
        default:
          return UNDEFINED_VALUE;
      }
    },
  );

/** `styled(tag)`, which is also `styled.div`, `styled.span`, ... */
const STYLED = lazyProperties(
  nativeFunction("styled", ([target = UNDEFINED_VALUE]) =>
    constructWithOptions(target, DEFAULT_OPTIONS),
  ),
  (key) => constructWithOptions(primitiveValue(key), DEFAULT_OPTIONS),
);

const themeProviderValue = (props: StaticObjectValue, tools: StubRenderTools): StaticValue => {
  const outerTheme = tools.readContext(THEME_CONTEXT);
  const theme = getObjectProperty(props, "theme");
  if (isFunctionLike(theme)) return tools.call(theme, [outerTheme]);
  return mapValue(outerTheme, (outer) =>
    getTruthiness(outer) === false
      ? theme
      : objectValue([
          { kind: "spread", value: outer },
          { kind: "spread", value: theme },
        ]),
  );
};

const THEME_PROVIDER_STUB: StubComponent = {
  displayName: null,
  render: (props, tools) => {
    const children = getObjectProperty(props, "children");
    return mapValue(children, (alternative) =>
      getTruthiness(alternative) === false
        ? primitiveValue(null)
        : element(
            { kind: "context-provider", context: THEME_CONTEXT, displayName: null },
            objectFromRecord({ value: themeProviderValue(props, tools), children: alternative }),
          ),
    );
  },
};

const GLOBAL_STYLE_STUB: StubComponent = { displayName: null, render: () => primitiveValue(null) };

const withTheme = nativeFunction("withTheme", ([component = UNDEFINED_VALUE]) =>
  stubValue({
    displayName: `WithTheme(${describeTag(component)})`,
    tag: ForwardRefTag,
    render: (props, tools) =>
      element(
        toElementType(component, null),
        objectValue([
          { kind: "spread", value: props },
          {
            kind: "property",
            key: "theme",
            value: firstTruthy(
              [getObjectProperty(props, "theme"), tools.readContext(THEME_CONTEXT)],
              "the theme prop's truthiness is not statically known",
            ),
          },
        ]),
      ),
  }),
);

const cssRules = (): StaticValue =>
  listValue([unknownPrimitiveValue("string", "styled-components css rules")]);

export const styledComponentsValue: LibraryValueProvider = (specifier, importedName) => {
  if (specifier !== "styled-components") return null;
  switch (importedName) {
    case "default":
    case "styled":
      return STYLED;
    case "ThemeProvider":
      return stubValue(THEME_PROVIDER_STUB);
    case "ThemeContext":
      return { kind: "context", context: THEME_CONTEXT };
    case "useTheme":
      return nativeFunction("useTheme", (_args, tools) => tools.readContext(THEME_CONTEXT));
    case "withTheme":
      return withTheme;
    case "createGlobalStyle":
      return nativeFunction("createGlobalStyle", () => stubValue(GLOBAL_STYLE_STUB));
    case "css":
      return nativeFunction("css", cssRules);
    case "keyframes":
      return nativeFunction("keyframes", () =>
        unknownPrimitiveValue("string", "styled-components keyframes name"),
      );
    default:
      return null;
  }
};
