import {
  UNDEFINED_VALUE,
  branchValue,
  getObjectProperty,
  getTruthiness,
  isFunctionValue,
  listValue,
  mapValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
} from "../evaluate/values.js";
import { element, lazyProperties, nativeFunction, stubValue } from "../evaluate/stubs.js";
import { toElementType } from "../react/element-type.js";
import type {
  ContextDefinition,
  LibraryValueProvider,
  ProjectContext,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";
import { ClassComponentTag, ForwardRefTag } from "../work-tags.js";
import { describeTag } from "./component-name.js";
import { isVersionAtLeast } from "./installed-version.js";

// styled-components 5/6's fiber-visible surface (`models/StyledComponent`). A
// styled component is a `forwardRef` named `styled.<tag>` / `Styled(<name>)`
// (or `withConfig({ displayName })`) rendering exactly one element: `$as`/`as`
// or its target, with the resolved `attrs` merged over the props and transient
// (`$`-prefixed) props dropped unless a `shouldForwardProp` decides. Styling a
// styled component folds onto its target and attrs. `ThemeProvider` merges into
// a nameless context; `createGlobalStyle` renders nothing. The package ships
// minified, so React reports its own components (`ThemeProvider`, a global
// style's memo) under minifier names the analysis cannot know.
//
// styled-components 4 (unminified `dist/*.browser.esm.js`) is class based: the
// `styled.<tag>` forwardRef renders the `StyledComponent` class, which reads the
// sheet and theme through `StyleSheetConsumer`/`ThemeConsumer` render props
// (`ComponentStyle.isStatic` is false whenever `module.hot` exists or
// `NODE_ENV` is not production, i.e. under any dev server) and, before 4.4,
// lets props win over attrs. `ThemeProvider` is a class rendering a
// `ThemeContext.Consumer` around its provider, `withTheme` reads the theme
// through a consumer, and a global style renders its consumers around nothing
// (`GlobalStyle.isStatic` skips the theme when no interpolation is a function).

export const STYLED_COMPONENTS_PACKAGES = ["styled-components"];

interface StyledRuntime {
  hasConsumerFibers: boolean;
  attrsOverrideProps: boolean;
}

const STYLED_5: StyledRuntime = { hasConsumerFibers: false, attrsOverrideProps: true };
const STYLED_4_4: StyledRuntime = { hasConsumerFibers: true, attrsOverrideProps: true };
const STYLED_4: StyledRuntime = { hasConsumerFibers: true, attrsOverrideProps: false };

const THEME_CONTEXT: ContextDefinition = {
  name: "ThemeContext",
  displayName: null,
  defaultValue: UNDEFINED_VALUE,
  location: null,
};

const STYLE_SHEET_CONTEXT: ContextDefinition = {
  name: "StyleSheetContext",
  displayName: null,
  defaultValue: UNDEFINED_VALUE,
  location: null,
};

const readRuntime = (project: ProjectContext): StyledRuntime => {
  const version = project.readPackageVersion("styled-components");
  if (version === null || isVersionAtLeast(version, "5.0.0")) return STYLED_5;
  return isVersionAtLeast(version, "4.4.0") ? STYLED_4_4 : STYLED_4;
};

const consumerOf = (context: ContextDefinition, render: (provided: StaticValue) => StaticValue) =>
  element(
    { kind: "context-consumer", context, displayName: null },
    objectFromRecord({
      children: nativeFunction("children", ([provided = UNDEFINED_VALUE]) => render(provided)),
    }),
  );

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
      value: isFunctionValue(attr) ? tools.call(attr, [context]) : attr,
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

const themeOf = (props: StaticObjectValue, theme: StaticValue): StaticValue =>
  firstTruthy(
    [getObjectProperty(props, "theme"), theme],
    "the theme prop's truthiness is not statically known",
  );

/**
 * `renderInner`: the target (or `as`) with the attrs merged over or under the
 * props. Version 4 picks `as` from the props before the attrs whichever wins
 * the merge; 5+ reads `$as`/`as` off the merged props.
 */
const renderStyledElement = (
  styled: StyledComponent,
  props: StaticObjectValue,
  theme: StaticValue,
  runtime: StyledRuntime,
  tools: StubRenderTools,
): StaticValue => {
  const attrs = objectValue(resolveAttrs(props, theme, styled.attrs, tools));
  const ownProps: StaticObjectEntry = { kind: "spread", value: props };
  const attrProps: StaticObjectEntry = { kind: "spread", value: attrs };
  const computedProps = objectValue(
    runtime.attrsOverrideProps ? [ownProps, attrProps] : [attrProps, ownProps],
  );
  const elementToBeCreated = firstTruthy(
    runtime.hasConsumerFibers
      ? [getObjectProperty(props, "as"), getObjectProperty(attrs, "as"), styled.target]
      : [
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
};

/** Version 4's `StyledComponent` class: `StyleSheetConsumer` -> `ThemeConsumer` -> the element. */
const STYLED_COMPONENT_CLASS = new WeakMap<StyledComponent, StubComponent>();

const styledComponentClass = (styled: StyledComponent, runtime: StyledRuntime): StubComponent => {
  let stub = STYLED_COMPONENT_CLASS.get(styled);
  if (stub === undefined) {
    stub = {
      displayName: "StyledComponent",
      tag: ClassComponentTag,
      render: (props, tools) =>
        consumerOf(STYLE_SHEET_CONTEXT, () =>
          consumerOf(THEME_CONTEXT, (theme) =>
            renderStyledElement(styled, props, themeOf(props, theme), runtime, tools),
          ),
        ),
    };
    STYLED_COMPONENT_CLASS.set(styled, stub);
  }
  return stub;
};

/** `createStyledComponent(target, options, rules)`: the rules only produce class names. */
const createStyledComponent = (
  target: StaticValue,
  options: StyledOptions,
  runtime: StyledRuntime,
): StaticValue => {
  const styledTarget = getStyledComponent(target);
  const styled: StyledComponent = {
    target: styledTarget ? styledTarget.target : target,
    attrs: [...(styledTarget?.attrs ?? []), ...options.attrs],
    propFilters: composePropFilters(styledTarget, options.shouldForwardProp),
  };
  const stub: StubComponent = {
    displayName: options.displayName ?? generateDisplayName(target),
    tag: ForwardRefTag,
    render: (props, tools) =>
      runtime.hasConsumerFibers
        ? element({ kind: "stub", stub: styledComponentClass(styled, runtime) }, props)
        : renderStyledElement(
            styled,
            props,
            themeOf(props, tools.readContext(THEME_CONTEXT)),
            runtime,
            tools,
          ),
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
    shouldForwardProp: isFunctionValue(filter) ? filter : options.shouldForwardProp,
    displayName:
      displayName.kind === "primitive" && typeof displayName.value === "string"
        ? displayName.value
        : options.displayName,
  };
};

/** `constructWithOptions`: a template function carrying `.withConfig()` and `.attrs()`. */
const constructWithOptions = (
  target: StaticValue,
  options: StyledOptions,
  runtime: StyledRuntime,
): StaticValue =>
  lazyProperties(
    nativeFunction("styled", () => createStyledComponent(target, options, runtime)),
    (key) => {
      switch (key) {
        case "withConfig":
          return nativeFunction("withConfig", ([config = UNDEFINED_VALUE]) =>
            constructWithOptions(target, readConfig(options, config), runtime),
          );
        case "attrs":
          return nativeFunction("attrs", ([attr = UNDEFINED_VALUE]) =>
            constructWithOptions(target, { ...options, attrs: [...options.attrs, attr] }, runtime),
          );
        default:
          return UNDEFINED_VALUE;
      }
    },
  );

/** `styled(tag)`, which is also `styled.div`, `styled.span`, ... */
const STYLED_FACTORIES = new WeakMap<StyledRuntime, StaticValue>();

const styledFactory = (runtime: StyledRuntime): StaticValue => {
  let factory = STYLED_FACTORIES.get(runtime);
  if (factory === undefined) {
    factory = lazyProperties(
      nativeFunction("styled", ([target = UNDEFINED_VALUE]) =>
        constructWithOptions(target, DEFAULT_OPTIONS, runtime),
      ),
      (key) => constructWithOptions(primitiveValue(key), DEFAULT_OPTIONS, runtime),
    );
    STYLED_FACTORIES.set(runtime, factory);
  }
  return factory;
};

const themeProviderValue = (props: StaticObjectValue, tools: StubRenderTools): StaticValue => {
  const outerTheme = tools.readContext(THEME_CONTEXT);
  const theme = getObjectProperty(props, "theme");
  if (isFunctionValue(theme)) return tools.call(theme, [outerTheme]);
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

/** Version 4's `ThemeProvider` class: nothing without children, else a consumer around the provider. */
const THEME_PROVIDER_CLASS_STUB: StubComponent = {
  displayName: "ThemeProvider",
  tag: ClassComponentTag,
  render: (props, tools) => {
    const children = getObjectProperty(props, "children");
    return mapValue(children, (alternative) =>
      getTruthiness(alternative) === false
        ? primitiveValue(null)
        : consumerOf(THEME_CONTEXT, () =>
            element(
              { kind: "context-provider", context: THEME_CONTEXT, displayName: null },
              objectFromRecord({ value: themeProviderValue(props, tools), children: alternative }),
            ),
          ),
    );
  },
};

const GLOBAL_STYLE_STUB: StubComponent = { displayName: null, render: () => primitiveValue(null) };

/** `isStaticRules`: a function interpolation (other than a styled component) makes the rules dynamic. */
const isStaticRules = (interpolations: readonly StaticValue[]): boolean | null => {
  let isKnown = true;
  for (const interpolation of interpolations) {
    if (isFunctionValue(interpolation)) return false;
    if (interpolation.kind === "unknown" || interpolation.kind === "branch") isKnown = false;
  }
  return isKnown ? true : null;
};

/** Version 4's `GlobalStyleComponent` class: its consumers around nothing. */
const globalStyleClass = (interpolations: readonly StaticValue[]): StubComponent => {
  const isStatic = isStaticRules(interpolations);
  const themed = () => consumerOf(THEME_CONTEXT, () => primitiveValue(null));
  return {
    displayName: "GlobalStyleComponent",
    tag: ClassComponentTag,
    render: () =>
      consumerOf(STYLE_SHEET_CONTEXT, () =>
        isStatic === null
          ? branchValue(
              [primitiveValue(null), themed()],
              "whether a global style interpolation is a function",
              null,
            )
          : isStatic
            ? primitiveValue(null)
            : themed(),
      ),
  };
};

const withThemeOf = (runtime: StyledRuntime): StaticValue =>
  nativeFunction("withTheme", ([component = UNDEFINED_VALUE]) => {
    const themed = (props: StaticObjectValue, theme: StaticValue): StaticValue =>
      element(
        toElementType(component, null),
        objectValue([
          { kind: "spread", value: props },
          { kind: "property", key: "theme", value: themeOf(props, theme) },
        ]),
      );
    return stubValue({
      displayName: `WithTheme(${describeTag(component)})`,
      tag: ForwardRefTag,
      render: (props, tools) =>
        runtime.hasConsumerFibers
          ? consumerOf(THEME_CONTEXT, (theme) => themed(props, theme))
          : themed(props, tools.readContext(THEME_CONTEXT)),
    });
  });

const WITH_THEME = new WeakMap<StyledRuntime, StaticValue>();

const withThemeFor = (runtime: StyledRuntime): StaticValue => {
  let withTheme = WITH_THEME.get(runtime);
  if (withTheme === undefined) {
    withTheme = withThemeOf(runtime);
    WITH_THEME.set(runtime, withTheme);
  }
  return withTheme;
};

const cssRules = (): StaticValue =>
  listValue([unknownPrimitiveValue("string", "styled-components css rules")]);

export const styledComponentsValue: LibraryValueProvider = (specifier, importedName, run) => {
  if (specifier !== "styled-components") return null;
  const runtime = readRuntime(run.project);
  switch (importedName) {
    case "default":
    case "styled":
      return styledFactory(runtime);
    case "ThemeProvider":
      return stubValue(runtime.hasConsumerFibers ? THEME_PROVIDER_CLASS_STUB : THEME_PROVIDER_STUB);
    case "ThemeContext":
      return { kind: "context", context: THEME_CONTEXT };
    case "ThemeConsumer":
      return {
        kind: "component-reference",
        type: { kind: "context-consumer", context: THEME_CONTEXT, displayName: null },
      };
    case "useTheme":
      return nativeFunction("useTheme", (_args, tools) => tools.readContext(THEME_CONTEXT));
    case "withTheme":
      return withThemeFor(runtime);
    case "createGlobalStyle":
      return nativeFunction("createGlobalStyle", ([, ...interpolations]) =>
        stubValue(runtime.hasConsumerFibers ? globalStyleClass(interpolations) : GLOBAL_STYLE_STUB),
      );
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
