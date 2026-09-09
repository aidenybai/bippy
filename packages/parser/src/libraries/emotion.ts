import isPropValid from "@emotion/is-prop-valid";
import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  getObjectProperty,
  getTruthiness,
  isFunctionValue,
  isNullish,
  listValue,
  mapValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { hasProperty } from "../evaluate/has-property.js";
import { element, emptyStub, nativeFunction, stubValue } from "../evaluate/stubs.js";
import { toElementType } from "../react/element-type.js";
import type {
  ContextDefinition,
  LibraryValueProvider,
  ProjectContext,
  ReactApi,
  StaticElementType,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";
import { ForwardRefTag } from "../work-tags.js";
import { describeTag } from "./component-name.js";

// Emotion's fiber-visible surface. A styled component is a `forwardRef`
// (`withEmotionCache`) rendering a null-returning placeholder (the styles go to
// a stylesheet) followed by its base tag with the props that survive
// `shouldForwardProp` (`@emotion/is-prop-valid` for host tags, everything but
// `theme` for components). Styling a styled component composes the styles and
// keeps the original base, so `styled(Flex)` renders Flex's `div`, not Flex.
// An element with a `css` prop is rewritten by Emotion's `jsx` into the same
// shape under `EmotionCssPropInternal`. Emotion 10 (`@emotion/core`,
// `@emotion/styled@10`) reads the cache and theme through `Consumer` render
// props, each its own fiber; 11 reads them with hooks. The class names
// themselves are hashes only the runtime can produce. Component names come from
// the label: a project building with Emotion's babel/swc plugin (`autoLabel:
// 'dev-only'` by default) or the `/macro` entry labels each styled call with the
// binding it is assigned to; otherwise Emotion falls back to `Styled(tag)`.

export const EMOTION_PACKAGES = [
  "@emotion/react",
  "@emotion/core",
  "@emotion/styled",
  "@emotion/is-prop-valid",
];

const LABEL_PLUGIN_PACKAGES = [
  "@emotion/babel-plugin",
  "@emotion/babel-preset-css-prop",
  "@swc/plugin-emotion",
  "babel-plugin-emotion",
];

const MACRO_SUFFIX = "/macro";

const FIRST_HOOKS_MAJOR = 11;

const CSS_PROP_TYPE_KEY = "__EMOTION_TYPE_PLEASE_DO_NOT_USE__";

interface EmotionRuntime {
  placeholder: StubComponent;
  hasConsumerFibers: boolean;
}

const EMOTION_10: EmotionRuntime = { placeholder: emptyStub("Noop"), hasConsumerFibers: true };

const EMOTION_11: EmotionRuntime = {
  placeholder: emptyStub("Insertion"),
  hasConsumerFibers: false,
};

const readRuntime = (project: ProjectContext, packageName: string): EmotionRuntime => {
  const version = project.readPackageVersion(packageName);
  return version !== null && Number(version.split(".")[0]) < FIRST_HOOKS_MAJOR
    ? EMOTION_10
    : EMOTION_11;
};

const THEME_CONTEXT: ContextDefinition = {
  name: "ThemeContext",
  displayName: "EmotionThemeContext",
  defaultValue: objectValue(),
  location: null,
};

const CACHE_CONTEXT: ContextDefinition = {
  name: "EmotionCacheContext",
  displayName: "EmotionCacheContext",
  defaultValue: unknownValue("emotion cache"),
  location: null,
};

const placeholderOf = (runtime: EmotionRuntime): StaticValue =>
  element({ kind: "stub", stub: runtime.placeholder }, objectValue());

const consumerOf = (context: ContextDefinition, render: () => StaticValue): StaticValue =>
  element(
    { kind: "context-consumer", context, displayName: context.displayName },
    objectFromRecord({ children: nativeFunction("children", render) }),
  );

const withRuntimeConsumers = (
  runtime: EmotionRuntime,
  readsTheme: boolean | null,
  render: () => StaticValue,
): StaticValue => {
  if (!runtime.hasConsumerFibers) return render();
  const themed = () => consumerOf(THEME_CONTEXT, render);
  return consumerOf(CACHE_CONTEXT, () =>
    readsTheme === null
      ? branchValue([themed(), render()], "whether the css prop is a theme function", null)
      : readsTheme
        ? themed()
        : render(),
  );
};

const serializedStyles = (): StaticValue =>
  objectFromRecord({
    name: unknownPrimitiveValue("string", "emotion style hash"),
    styles: unknownPrimitiveValue("string", "serialized emotion styles"),
  });

const classNameValue = (): StaticValue => unknownPrimitiveValue("string", "emotion class name");

const fragmentOf = (children: StaticValue[]): StaticValue =>
  element({ kind: "fragment" }, objectFromRecord({ children: listValue(children) }));

interface StyledComponent {
  /** `__emotion_base`: the host tag name or component the whole styled chain renders. */
  baseTag: StaticValue;
  /** `__emotion_forwardProp`: user filters composed along the chain; null means Emotion's default. */
  propFilters: readonly StaticValue[] | null;
  label: string | null;
  options: StaticValue | undefined;
}

interface StyledFactoryOptions {
  hasAutoLabel: boolean;
  runtime: EmotionRuntime;
}

const STYLED_COMPONENTS = new WeakMap<StubComponent, StyledComponent>();

const getStyledComponent = (tag: StaticValue): StyledComponent | undefined =>
  tag.kind === "component-reference" && tag.type.kind === "stub"
    ? STYLED_COMPONENTS.get(tag.type.stub)
    : undefined;

const getOption = (options: StaticValue | undefined, key: string): StaticValue =>
  options?.kind === "object" ? getObjectProperty(options, key) : UNDEFINED_VALUE;

const getStringOption = (options: StaticValue | undefined, key: string): string | null => {
  const value = getOption(options, key);
  return value.kind === "primitive" && typeof value.value === "string" ? value.value : null;
};

const composePropFilters = (
  options: StaticValue | undefined,
  styledTag: StyledComponent | undefined,
): readonly StaticValue[] | null => {
  const optionFilter = getOption(options, "shouldForwardProp");
  if (isFunctionValue(optionFilter)) {
    return styledTag?.propFilters ? [...styledTag.propFilters, optionFilter] : [optionFilter];
  }
  return styledTag ? styledTag.propFilters : null;
};

const defaultForwardsProp = (tag: StaticElementType, key: string): boolean =>
  tag.kind === "host" && /^[a-z]/.test(tag.tagName) ? isPropValid(key) : key !== "theme";

/** null when a user filter's verdict is not statically known. */
const forwardsProp = (
  filters: readonly StaticValue[] | null,
  finalTag: StaticElementType,
  key: string,
  tools: StubRenderTools,
): boolean | null => {
  if (filters === null) return defaultForwardsProp(finalTag, key);
  let isUnknown = false;
  for (const filter of filters) {
    const verdict = getTruthiness(tools.call(filter, [primitiveValue(key)]));
    if (verdict === false) return false;
    if (verdict === null) isUnknown = true;
  }
  return isUnknown ? null : true;
};

const forwardedProps = (
  props: StaticObjectValue,
  finalTag: StaticElementType,
  filters: readonly StaticValue[] | null,
  shouldUseAs: boolean | null,
  tools: StubRenderTools,
): StaticObjectEntry[] => {
  const entries: StaticObjectEntry[] = [];
  for (const entry of props.entries) {
    if (entry.kind === "spread") {
      if (entry.value.kind === "object") {
        entries.push(...forwardedProps(entry.value, finalTag, filters, shouldUseAs, tools));
      } else {
        entries.push(entry);
      }
      continue;
    }
    if (entry.key === "as" && shouldUseAs !== false) continue;
    if (entry.key === "ref" || forwardsProp(filters, finalTag, entry.key, tools) !== false) {
      entries.push(entry);
    }
  }
  return entries;
};

const resolveFinalTag = (
  asValue: StaticValue,
  baseTag: StaticValue,
  shouldUseAs: boolean | null,
): StaticValue => {
  if (shouldUseAs === false || isNullish(asValue) === true) return baseTag;
  const asOrBase = mapValue(asValue, (alternative) =>
    getTruthiness(alternative) === false ? baseTag : alternative,
  );
  return shouldUseAs === true
    ? asOrBase
    : branchValue([asOrBase, baseTag], "shouldForwardProp('as') is not statically known", null);
};

const styledOutput = (
  runtime: EmotionRuntime,
  finalType: StaticElementType,
  entries: StaticObjectEntry[],
): StaticValue => {
  entries.push({ kind: "property", key: "className", value: classNameValue() });
  return fragmentOf([placeholderOf(runtime), element(finalType, objectValue(entries))]);
};

const createStyled = (
  tag: StaticValue,
  options: StaticValue | undefined,
  label: string | null,
  runtime: EmotionRuntime,
  tools: StubRenderTools,
): StaticValue => {
  const styledTag = getStyledComponent(tag);
  const baseTag = styledTag ? styledTag.baseTag : tag;
  const propFilters = composePropFilters(options, styledTag);
  const forwardsAs = forwardsProp(propFilters, toElementType(baseTag, null), "as", tools);
  const shouldUseAs = forwardsAs === null ? null : !forwardsAs;
  const properties = new Map<string, StaticValue>();
  const stub: StubComponent = {
    displayName: label ?? `Styled(${describeTag(baseTag)})`,
    tag: ForwardRefTag,
    properties,
    render: (props, renderTools) =>
      withRuntimeConsumers(runtime, true, () => {
        const finalTag = resolveFinalTag(getObjectProperty(props, "as"), baseTag, shouldUseAs);
        return mapValue(finalTag, (tagValue) => {
          const finalType = toElementType(tagValue, null);
          return styledOutput(
            runtime,
            finalType,
            forwardedProps(props, finalType, propFilters, shouldUseAs, renderTools),
          );
        });
      }),
  };
  const styled: StyledComponent = { baseTag, propFilters, label, options };
  STYLED_COMPONENTS.set(stub, styled);
  properties.set("withComponent", withComponent(styled, runtime));
  return stubValue(stub);
};

/** `Styled.withComponent(nextTag, nextOptions)`: the same styles and filters on another base. */
const withComponent = (styled: StyledComponent, runtime: EmotionRuntime): StaticValue =>
  nativeFunction("withComponent", ([nextTag = UNDEFINED_VALUE, nextOptions], tools) => {
    const filters = composePropFilters(nextOptions, styled);
    const merged = objectValue([
      ...(styled.options?.kind === "object" ? styled.options.entries : []),
      ...(nextOptions?.kind === "object" ? nextOptions.entries : []),
      ...(filters ? [composedFilterEntry(filters)] : []),
    ]);
    return createStyled(nextTag, merged, styled.label, runtime, tools);
  });

const composedFilterEntry = (filters: readonly StaticValue[]): StaticObjectEntry => ({
  kind: "property",
  key: "shouldForwardProp",
  value: nativeFunction("shouldForwardProp", ([key = UNDEFINED_VALUE], tools) => {
    for (const filter of filters) {
      const verdict = tools.call(filter, [key]);
      if (getTruthiness(verdict) !== true) return verdict;
    }
    return primitiveValue(true);
  }),
});

const styledFactory = (
  tag: StaticValue,
  options: StaticValue | undefined,
  { hasAutoLabel, runtime }: StyledFactoryOptions,
): StaticValue =>
  nativeFunction("styled", (_styles, tools) =>
    createStyled(
      tag,
      options,
      getStringOption(options, "label") ?? (hasAutoLabel ? tools.nameHint : null),
      runtime,
      tools,
    ),
  );

/** `styled(tag, options?)`, which is also `styled.div`, `styled.span`, ... */
const styledValue = (factoryOptions: StyledFactoryOptions): StaticValue => ({
  kind: "proxy",
  target: nativeFunction("styled", ([tag = UNDEFINED_VALUE, options]) =>
    styledFactory(tag, options, factoryOptions),
  ),
  handler: objectFromRecord({
    get: nativeFunction("styled.<tag>", ([, key]) =>
      key?.kind === "primitive" && typeof key.value === "string"
        ? styledFactory(primitiveValue(key.value), undefined, factoryOptions)
        : unknownValue("styled tag name"),
    ),
  }),
});

const THEME_PROVIDER_STUB: StubComponent = {
  displayName: "ThemeProvider",
  render: (props, tools) => {
    const outerTheme = tools.readContext(THEME_CONTEXT);
    const theme = getObjectProperty(props, "theme");
    const merged =
      theme.kind === "function"
        ? tools.call(theme, [outerTheme])
        : objectValue([
            { kind: "spread", value: outerTheme },
            { kind: "spread", value: theme },
          ]);
    return element(
      { kind: "context-provider", context: THEME_CONTEXT, displayName: THEME_CONTEXT.displayName },
      objectFromRecord({ value: merged, children: getObjectProperty(props, "children") }),
    );
  },
};

const GLOBAL_STUB: StubComponent = { ...emptyStub("EmotionGlobal"), tag: ForwardRefTag };

const classNamesStub = (runtime: EmotionRuntime): StubComponent => ({
  displayName: "EmotionClassNames",
  tag: ForwardRefTag,
  render: (props, tools) =>
    withRuntimeConsumers(runtime, true, () => {
      const content = objectFromRecord({
        css: nativeFunction("css", classNameValue),
        cx: nativeFunction("cx", classNameValue),
        theme: tools.readContext(THEME_CONTEXT),
      });
      return fragmentOf([
        placeholderOf(runtime),
        tools.call(getObjectProperty(props, "children"), [content]),
      ]);
    }),
});

const cssPropStub = (runtime: EmotionRuntime): StubComponent => ({
  displayName: "EmotionCssPropInternal",
  tag: ForwardRefTag,
  render: (props) => {
    const cssProp = getObjectProperty(props, "css");
    const readsTheme = isFunctionValue(cssProp)
      ? true
      : cssProp.kind === "unknown" || cssProp.kind === "branch"
        ? null
        : false;
    return withRuntimeConsumers(runtime, readsTheme, () =>
      mapValue(getObjectProperty(props, CSS_PROP_TYPE_KEY), (typeValue) =>
        styledOutput(
          runtime,
          toElementType(typeValue, null),
          props.entries.filter(
            (entry) =>
              entry.kind !== "property" || (entry.key !== "css" && entry.key !== CSS_PROP_TYPE_KEY),
          ),
        ),
      ),
    );
  },
});

const hasCssProp = (props: StaticValue): boolean | null => {
  if (isNullish(props) === true) return false;
  const verdict = hasProperty(primitiveValue("css"), props);
  return verdict === null ? null : getTruthiness(verdict);
};

const CSS_PROP_STUBS = new WeakMap<EmotionRuntime, StubComponent>();

const getCssPropStub = (runtime: EmotionRuntime): StubComponent => {
  const cached = CSS_PROP_STUBS.get(runtime);
  if (cached) return cached;
  const stub = cssPropStub(runtime);
  CSS_PROP_STUBS.set(runtime, stub);
  return stub;
};

const jsxFactory = (api: ReactApi, runtime: EmotionRuntime): StaticValue =>
  nativeFunction(api, ([type = UNDEFINED_VALUE, props = NULL_VALUE, ...rest], tools) => {
    const react: StaticValue = { kind: "react-api", api };
    const plain = () => tools.call(react, [type, props, ...rest]);
    const styled = () => {
      const entries: StaticObjectEntry[] =
        props.kind === "object" ? [...props.entries] : [{ kind: "spread", value: props }];
      entries.push({ kind: "property", key: CSS_PROP_TYPE_KEY, value: type });
      return tools.call(react, [stubValue(getCssPropStub(runtime)), objectValue(entries), ...rest]);
    };
    switch (hasCssProp(props)) {
      case true:
        return styled();
      case false:
        return plain();
      case null:
        return branchValue(
          [styled(), plain()],
          "whether the props include `css` is not statically known",
          null,
        );
    }
  });

const withTheme = (): StaticValue =>
  nativeFunction("withTheme", ([component = UNDEFINED_VALUE]) => {
    const inner = toElementType(component, null);
    const stub: StubComponent = {
      displayName: `WithTheme(${describeTag(component)})`,
      tag: ForwardRefTag,
      render: (props, tools) =>
        element(
          inner,
          objectValue([
            { kind: "property", key: "theme", value: tools.readContext(THEME_CONTEXT) },
            { kind: "spread", value: props },
          ]),
        ),
    };
    return stubValue(stub);
  });

const reactValue = (importedName: string, runtime: EmotionRuntime): StaticValue | null => {
  switch (importedName) {
    case "jsx":
      return jsxFactory("createElement", runtime);
    case "ThemeProvider":
      return stubValue(THEME_PROVIDER_STUB);
    case "useTheme":
      return nativeFunction("useTheme", (_args, tools) => tools.readContext(THEME_CONTEXT));
    case "withTheme":
      return withTheme();
    case "ThemeContext":
      return { kind: "context", context: THEME_CONTEXT };
    case "CacheProvider":
      return {
        kind: "component-reference",
        type: {
          kind: "context-provider",
          context: CACHE_CONTEXT,
          displayName: CACHE_CONTEXT.displayName,
        },
      };
    case "__unsafe_useEmotionCache":
      return nativeFunction("useEmotionCache", (_args, tools) => tools.readContext(CACHE_CONTEXT));
    case "Global":
      return stubValue(GLOBAL_STUB);
    case "ClassNames":
      return stubValue(classNamesStub(runtime));
    case "css":
    case "keyframes":
      return nativeFunction(importedName, serializedStyles);
    case "Fragment":
      return { kind: "react-api", api: "Fragment" };
    default:
      return null;
  }
};

const JSX_RUNTIME_SPECIFIERS: ReadonlyMap<string, ReactApi> = new Map([
  ["@emotion/react/jsx-runtime", "jsx"],
  ["@emotion/react/jsx-dev-runtime", "jsxDEV"],
]);

export const emotionValue: LibraryValueProvider = (specifier, importedName, project) => {
  const isMacro = specifier.endsWith(MACRO_SUFFIX);
  const packageName = isMacro ? specifier.slice(0, -MACRO_SUFFIX.length) : specifier;
  if (packageName === "@emotion/styled" || packageName === "@emotion/styled/base") {
    if (importedName !== "default") return null;
    return styledValue({
      hasAutoLabel:
        isMacro ||
        LABEL_PLUGIN_PACKAGES.some((pluginName) => project.hasDeclaredDependency(pluginName)),
      runtime: readRuntime(project, "@emotion/styled"),
    });
  }
  if (packageName === "@emotion/core") return reactValue(importedName, EMOTION_10);
  if (packageName === "@emotion/react") {
    return reactValue(importedName, readRuntime(project, packageName));
  }
  const runtimeApi = JSX_RUNTIME_SPECIFIERS.get(specifier);
  if (runtimeApi !== undefined) {
    if (importedName === "jsx" || importedName === "jsxs" || importedName === "jsxDEV") {
      return jsxFactory(runtimeApi, readRuntime(project, "@emotion/react"));
    }
    if (importedName === "Fragment") return { kind: "react-api", api: "Fragment" };
  }
  if (specifier === "@emotion/is-prop-valid" && importedName === "default") {
    return nativeFunction("isPropValid", ([key]) =>
      key?.kind === "primitive" && typeof key.value === "string"
        ? primitiveValue(isPropValid(key.value))
        : unknownPrimitiveValue("boolean", "isPropValid of a dynamic prop name"),
    );
  }
  return null;
};
