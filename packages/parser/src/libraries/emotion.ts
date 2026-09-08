import isPropValid from "@emotion/is-prop-valid";
import {
  UNDEFINED_VALUE,
  branchValue,
  describeElementType,
  getObjectProperty,
  getStubDisplayName,
  getTruthiness,
  isNullish,
  listValue,
  mapValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { element, emptyStub, nativeFunction, stubValue } from "../frameworks/stubs.js";
import { toElementType } from "../react/element-type.js";
import type {
  ContextDefinition,
  LibraryValueProvider,
  StaticElementType,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";
import { ForwardRefTag } from "../work-tags.js";

// Emotion 11's fiber-visible surface. A styled component is a `forwardRef`
// (`withEmotionCache`) rendering `<Insertion/>` (returns null; the styles go to a
// stylesheet) followed by its base tag with the props that survive
// `shouldForwardProp` (`@emotion/is-prop-valid` for host tags, everything but
// `theme` for components). Styling a styled component composes the styles and
// keeps the original base, so `styled(Flex)` renders Flex's `div`, not Flex.
// The class names themselves are hashes only the runtime can produce. Component
// names come from the label: a project building with Emotion's babel/swc plugin
// (`autoLabel: 'dev-only'` by default) labels each styled call with the binding
// it is assigned to; otherwise Emotion falls back to `Styled(tag)`.

export const EMOTION_PACKAGES = ["@emotion/react", "@emotion/styled", "@emotion/is-prop-valid"];

const LABEL_PLUGIN_PACKAGES = ["@emotion/babel-plugin", "@swc/plugin-emotion"];

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

const INSERTION_STUB = emptyStub("Insertion");

const insertion = (): StaticValue => element({ kind: "stub", stub: INSERTION_STUB }, objectValue());

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

const isFunctionLike = (value: StaticValue): boolean =>
  value.kind === "function" || value.kind === "native-function";

const composePropFilters = (
  options: StaticValue | undefined,
  styledTag: StyledComponent | undefined,
): readonly StaticValue[] | null => {
  const optionFilter = getOption(options, "shouldForwardProp");
  if (isFunctionLike(optionFilter)) {
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

const getStringProperty = (
  properties: ReadonlyMap<string, StaticValue>,
  key: string,
): string | null => {
  const value = properties.get(key);
  return value?.kind === "primitive" && typeof value.value === "string" ? value.value : null;
};

/** `tag.displayName || tag.name || 'Component'`: wrapper objects have no `name`. */
const describeTag = (tag: StaticValue): string => {
  const type = toElementType(tag, null);
  switch (type.kind) {
    case "host":
      return type.tagName;
    case "function":
    case "class":
      return (
        getStringProperty(type.component.properties, "displayName") ??
        type.component.name ??
        "Component"
      );
    case "memo":
    case "forward-ref":
    case "lazy":
      return type.displayName ?? "Component";
    case "stub":
      return getStubDisplayName(type.stub) ?? "Component";
    default:
      return describeElementType(type);
  }
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

const createStyled = (
  tag: StaticValue,
  options: StaticValue | undefined,
  label: string | null,
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
    render: (props, renderTools) => {
      const finalTag = resolveFinalTag(getObjectProperty(props, "as"), baseTag, shouldUseAs);
      return mapValue(finalTag, (tagValue) => {
        const finalType = toElementType(tagValue, null);
        const entries = forwardedProps(props, finalType, propFilters, shouldUseAs, renderTools);
        entries.push({ kind: "property", key: "className", value: classNameValue() });
        return fragmentOf([insertion(), element(finalType, objectValue(entries))]);
      });
    },
  };
  const styled: StyledComponent = { baseTag, propFilters, label, options };
  STYLED_COMPONENTS.set(stub, styled);
  properties.set("withComponent", withComponent(styled));
  return stubValue(stub);
};

/** `Styled.withComponent(nextTag, nextOptions)`: the same styles and filters on another base. */
const withComponent = (styled: StyledComponent): StaticValue =>
  nativeFunction("withComponent", ([nextTag = UNDEFINED_VALUE, nextOptions], tools) => {
    const filters = composePropFilters(nextOptions, styled);
    const merged = objectValue([
      ...(styled.options?.kind === "object" ? styled.options.entries : []),
      ...(nextOptions?.kind === "object" ? nextOptions.entries : []),
      ...(filters ? [composedFilterEntry(filters)] : []),
    ]);
    return createStyled(nextTag, merged, styled.label, tools);
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
  { hasAutoLabel }: StyledFactoryOptions,
): StaticValue =>
  nativeFunction("styled", (_styles, tools) =>
    createStyled(
      tag,
      options,
      getStringOption(options, "label") ?? (hasAutoLabel ? tools.nameHint : null),
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

const CLASS_NAMES_STUB: StubComponent = {
  displayName: "EmotionClassNames",
  tag: ForwardRefTag,
  render: (props, tools) => {
    const content = objectFromRecord({
      css: nativeFunction("css", classNameValue),
      cx: nativeFunction("cx", classNameValue),
      theme: tools.readContext(THEME_CONTEXT),
    });
    return fragmentOf([insertion(), tools.call(getObjectProperty(props, "children"), [content])]);
  },
};

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

const reactValue = (importedName: string): StaticValue | null => {
  switch (importedName) {
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
      return stubValue(CLASS_NAMES_STUB);
    case "css":
    case "keyframes":
      return nativeFunction(importedName, serializedStyles);
    case "Fragment":
      return { kind: "react-api", api: "Fragment" };
    default:
      return null;
  }
};

export const emotionValue: LibraryValueProvider = (specifier, importedName, project) => {
  if (specifier === "@emotion/styled") {
    if (importedName !== "default") return null;
    return styledValue({
      hasAutoLabel: LABEL_PLUGIN_PACKAGES.some((packageName) =>
        project.hasDeclaredDependency(packageName),
      ),
    });
  }
  if (specifier === "@emotion/react") return reactValue(importedName);
  if (specifier === "@emotion/is-prop-valid" && importedName === "default") {
    return nativeFunction("isPropValid", ([key]) =>
      key?.kind === "primitive" && typeof key.value === "string"
        ? primitiveValue(isPropValid(key.value))
        : unknownPrimitiveValue("boolean", "isPropValid of a dynamic prop name"),
    );
  }
  return null;
};
