import semver from "semver";
import { resolvedPromiseValue } from "../evaluate/promises.js";
import {
  branchValue,
  describeValue,
  FALSE_VALUE,
  getObjectProperty,
  getTruthiness,
  hasDefiniteItems,
  isKnownString,
  isNullish,
  objectFromRecord,
  objectValue,
  primitiveValue,
  thrownValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import {
  element,
  lazyProperties,
  nativeFunction,
  omitProps,
  stubValue,
} from "../frameworks/stubs.js";
import type {
  ContextDefinition,
  ExternalValueProvider,
  StaticObjectValue,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";
import { ForwardRefTag } from "../work-tags.js";
import { formatIcuMessage } from "./icu-message-format.js";

// `next-intl` and the `use-intl` core it wraps, from their source: the intl
// config lives in `IntlContext` on the client and in the request configuration
// (the module `next-intl/plugin` points `next-intl/config` at) in Server
// Components. Translations resolve from the configured messages; what only the
// request decides (a negotiated locale, the current time) stays uncertain.

export interface NextIntlModelOptions {
  /** The `next/link` component navigation links render through. */
  link: StubComponent;
  /** `next/navigation` exports the navigation hooks wrap. */
  navigation: (importedName: string) => StaticValue | null;
  /** Installed `next-intl` release; `null` when it cannot be read (the newest modeled shapes apply). */
  version: string | null;
}

export interface NextIntlModel {
  externalValues: ExternalValueProvider;
  /** Request configuration module `next-intl/plugin` was pointed at, once `next.config` ran; null when the plugin is not used. */
  getRequestConfigPath: () => string | null;
  /** Installs the request configuration module's default export, `getRequestConfig(...)`. */
  setRequestConfig: (config: StaticValue) => void;
}

interface RoutingConfig {
  mode: "always" | "as-needed" | "never" | null;
  prefixes: StaticValue;
  defaultLocale: string | null;
  hasPathnames: boolean;
  hasDomains: boolean;
  localeCookie: StaticValue;
}

interface MessageLookup {
  kind: "found" | "missing" | "unknown";
  value: StaticValue;
}

type TranslateMode = "string" | "rich" | "markup";

const INTL_CONTEXT: ContextDefinition = {
  name: "IntlContext",
  displayName: null,
  defaultValue: UNDEFINED_VALUE,
  location: null,
};

const DEFAULT_REQUEST_CONFIG_PATH = "./i18n/request";
const CONFIG_KEYS = [
  "locale",
  "messages",
  "formats",
  "timeZone",
  "now",
  "onError",
  "getMessageFallback",
];
const PROVIDER_INFERRED_PROPS: ReadonlySet<string> = new Set([
  "formats",
  "locale",
  "messages",
  "now",
  "timeZone",
]);

const isUndefined = (value: StaticValue): boolean =>
  value.kind === "primitive" && value.value === undefined;

const orValue = (left: StaticValue, right: StaticValue): StaticValue => {
  const truthiness = getTruthiness(left);
  if (truthiness === true) return left;
  if (truthiness === false) return right;
  return branchValue([left, right], `|| on ${describeValue(left)}`, null, 0);
};

const nullishValue = (left: StaticValue, right: StaticValue): StaticValue => {
  const nullish = isNullish(left);
  if (nullish === false) return left;
  if (nullish === true) return right;
  return branchValue([left, right], `?? on ${describeValue(left)}`, null, 0);
};

const knownString = (value: StaticValue): string | null =>
  isKnownString(value) ? value.value : null;

const joinPath = (namespace: string | null, key: string): string =>
  namespace === null ? key : `${namespace}.${key}`;

const pickConfig = (source: StaticObjectValue): StaticObjectValue =>
  objectFromRecord(
    Object.fromEntries(CONFIG_KEYS.map((key) => [key, getObjectProperty(source, key)])),
  );

const lookupMessage = (messages: StaticValue, path: string | null): MessageLookup => {
  let current = messages;
  for (const part of path === null ? [] : path.split(".")) {
    if (current.kind === "primitive") return { kind: "missing", value: current };
    if (current.kind !== "object") {
      return { kind: "unknown", value: unknownValue(`messages are ${describeValue(current)}`) };
    }
    const next = getObjectProperty(current, part);
    if (next.kind === "unknown" || next.kind === "branch") return { kind: "unknown", value: next };
    if (isNullish(next) === true) return { kind: "missing", value: next };
    current = next;
  }
  return isNullish(current) === true
    ? { kind: "missing", value: current }
    : { kind: "found", value: current };
};

const lookupTranslation = (
  config: StaticObjectValue,
  namespace: string | null,
  key: string,
): MessageLookup => {
  const scoped = lookupMessage(getObjectProperty(config, "messages"), namespace);
  return scoped.kind === "found" ? lookupMessage(scoped.value, key) : scoped;
};

const messageFallback = (
  config: StaticObjectValue,
  namespace: string | null,
  key: string,
  tools: StubRenderTools,
): StaticValue => {
  const getMessageFallback = getObjectProperty(config, "getMessageFallback");
  if (isNullish(getMessageFallback) === true) return primitiveValue(joinPath(namespace, key));
  return tools.call(getMessageFallback, [
    objectFromRecord({
      error: unknownValue("the IntlError raised for a missing or invalid message"),
      key: primitiveValue(key),
      namespace: namespace === null ? UNDEFINED_VALUE : primitiveValue(namespace),
    }),
  ]);
};

const unknownTranslation = (reason: string, mode: TranslateMode): StaticValue =>
  mode === "rich" ? unknownValue(reason) : unknownPrimitiveValue("string", reason);

const describeLookup = (lookup: MessageLookup): string =>
  lookup.value.kind === "unknown" ? lookup.value.reason : describeValue(lookup.value);

interface TranslationTarget {
  config: StaticObjectValue;
  namespace: string | null;
  key: string;
}

const resolveTarget = (
  config: StaticValue,
  namespaceValue: StaticValue,
  keyValue: StaticValue,
): TranslationTarget | string => {
  if (config.kind !== "object") return `intl config is ${describeValue(config)}`;
  if (!isKnownString(keyValue)) return `message key is ${describeValue(keyValue)}`;
  if (!isUndefined(namespaceValue) && !isKnownString(namespaceValue)) {
    return `namespace is ${describeValue(namespaceValue)}`;
  }
  return { config, namespace: knownString(namespaceValue), key: keyValue.value };
};

const translate = (
  configValue: StaticValue,
  namespaceValue: StaticValue,
  args: StaticValue[],
  tools: StubRenderTools,
  mode: TranslateMode,
): StaticValue => {
  const [keyValue = UNDEFINED_VALUE, values = UNDEFINED_VALUE, formats = UNDEFINED_VALUE] = args;
  const target = resolveTarget(configValue, namespaceValue, keyValue);
  if (typeof target === "string") return unknownTranslation(target, mode);
  const { config, namespace, key } = target;
  const fallback = (): StaticValue => messageFallback(config, namespace, key, tools);
  const lookup = lookupTranslation(config, namespace, key);
  if (lookup.kind === "unknown") return unknownTranslation(describeLookup(lookup), mode);
  if (lookup.kind === "missing") return fallback();
  const message = lookup.value;
  if (!isKnownString(message)) {
    const isInvalidMessage =
      message.kind === "primitive" || message.kind === "object" || message.kind === "list";
    return isInvalidMessage
      ? fallback()
      : unknownTranslation(`message "${key}" is ${describeValue(message)}`, mode);
  }
  const formatted = formatIcuMessage(
    message.value,
    values,
    {
      locale: knownString(getObjectProperty(config, "locale")),
      formats: [formats, getObjectProperty(config, "formats")],
    },
    tools,
  );
  if (formatted.kind === "unknown") return unknownTranslation(formatted.reason, mode);
  if (formatted.kind === "error") return fallback();
  const isStringResult =
    isKnownString(formatted.value) ||
    (formatted.value.kind === "unknown-primitive" && formatted.value.primitiveType === "string");
  return mode === "rich" || isStringResult ? formatted.value : fallback();
};

const translatorValue = (config: StaticValue, namespace: StaticValue): StaticValue => {
  const translator = (name: string, mode: TranslateMode): StaticValue =>
    nativeFunction(name, (args, tools) => translate(config, namespace, args, tools, mode));
  const lookup = (keyValue: StaticValue): MessageLookup | string => {
    const target = resolveTarget(config, namespace, keyValue);
    return typeof target === "string"
      ? target
      : lookupTranslation(target.config, target.namespace, target.key);
  };
  return lazyProperties(translator("t", "string"), (property) => {
    switch (property) {
      case "rich":
        return translator("rich", "rich");
      case "markup":
        return translator("markup", "markup");
      case "raw":
        return nativeFunction("raw", ([keyValue = UNDEFINED_VALUE]) => {
          const found = lookup(keyValue);
          if (typeof found === "string") return unknownValue(found);
          return found.kind === "missing"
            ? primitiveValue(joinPath(knownString(namespace), knownString(keyValue) ?? ""))
            : found.value;
        });
      case "has":
        return nativeFunction("has", ([keyValue = UNDEFINED_VALUE]) => {
          const found = lookup(keyValue);
          if (typeof found === "string") return unknownPrimitiveValue("boolean", found);
          if (found.kind === "unknown") {
            return unknownPrimitiveValue("boolean", describeLookup(found));
          }
          return found.kind === "found" ? TRUE_VALUE : FALSE_VALUE;
        });
      default:
        return UNDEFINED_VALUE;
    }
  });
};

const configFromProviderProps = (
  props: StaticObjectValue,
  inherited: StaticValue,
): StaticObjectValue => {
  const parent = (key: string): StaticValue =>
    inherited.kind === "object" ? getObjectProperty(inherited, key) : UNDEFINED_VALUE;
  const own = (key: string): StaticValue => getObjectProperty(props, key);
  const unlessUndefined = (key: string): StaticValue =>
    isUndefined(own(key)) ? parent(key) : own(key);
  return objectFromRecord({
    locale: own("locale"),
    formats: unlessUndefined("formats"),
    getMessageFallback: orValue(own("getMessageFallback"), parent("getMessageFallback")),
    messages: unlessUndefined("messages"),
    now: orValue(own("now"), parent("now")),
    onError: orValue(own("onError"), parent("onError")),
    timeZone: orValue(own("timeZone"), parent("timeZone")),
  });
};

const INTL_PROVIDER_STUB: StubComponent = {
  displayName: "IntlProvider",
  render: (props, tools) =>
    element(
      { kind: "context-provider", context: INTL_CONTEXT, displayName: null },
      objectFromRecord({
        value: configFromProviderProps(props, tools.readContext(INTL_CONTEXT)),
        children: getObjectProperty(props, "children"),
      }),
    ),
};

const renderClientProvider = (props: StaticObjectValue): StaticValue =>
  getTruthiness(getObjectProperty(props, "locale")) === false
    ? thrownValue(
        "NextIntlClientProvider throws without a `locale`",
        unknownValue("Couldn't infer the `locale` prop in `NextIntlClientProvider`"),
      )
    : element({ kind: "stub", stub: INTL_PROVIDER_STUB }, props);

/**
 * 3.x `getConfig.js` hands `getRequestConfig` a `locale` param that already
 * resolved the request locale and falls back to it when the config returns
 * none; its client bundle is minified, so `NextIntlClientProvider` renders as
 * `r`. 4.x passes only an explicit override, requires a returned locale and
 * ships an unminified `development` build.
 */
const LEGACY_VERSIONS = "<4.0.0";

const isLegacyVersion = (version: string | null): boolean =>
  version !== null && semver.satisfies(version, LEGACY_VERSIONS, { includePrerelease: true });

const createClientProviderStub = (isLegacy: boolean): StubComponent => ({
  displayName: isLegacy ? "r" : "NextIntlClientProvider",
  render: renderClientProvider,
});

const toRoutingConfig = (routing: StaticValue): RoutingConfig | null => {
  if (isNullish(routing) === true) {
    return {
      mode: "always",
      prefixes: UNDEFINED_VALUE,
      defaultLocale: null,
      hasPathnames: false,
      hasDomains: false,
      localeCookie: UNDEFINED_VALUE,
    };
  }
  if (routing.kind !== "object") return null;
  const localePrefix = getObjectProperty(routing, "localePrefix");
  const modeValue =
    localePrefix.kind === "object" ? getObjectProperty(localePrefix, "mode") : localePrefix;
  const mode = isNullish(modeValue) === true ? "always" : knownString(modeValue);
  return {
    mode: mode === "always" || mode === "as-needed" || mode === "never" ? mode : null,
    prefixes:
      localePrefix.kind === "object"
        ? getObjectProperty(localePrefix, "prefixes")
        : UNDEFINED_VALUE,
    defaultLocale: knownString(getObjectProperty(routing, "defaultLocale")),
    hasPathnames: isNullish(getObjectProperty(routing, "pathnames")) !== true,
    hasDomains: isNullish(getObjectProperty(routing, "domains")) !== true,
    localeCookie: getObjectProperty(routing, "localeCookie"),
  };
};

const isLocalizableHref = (href: string): boolean =>
  !/^[a-z]+:/i.test(href) && href.startsWith("/");

const getLocalePrefix = (locale: string, routing: RoutingConfig): string | null => {
  if (routing.mode === "never" || isNullish(routing.prefixes) === true) return `/${locale}`;
  if (routing.prefixes.kind !== "object") return null;
  const configured = getObjectProperty(routing.prefixes, locale);
  return isNullish(configured) === true ? `/${locale}` : knownString(configured);
};

const shouldPrefixPathname = (
  pathname: string,
  locale: string,
  routing: RoutingConfig,
  forcePrefix: boolean | null,
): boolean | null => {
  if (forcePrefix !== null) return forcePrefix;
  if (!isLocalizableHref(pathname)) return false;
  if (routing.hasDomains) return null;
  if (routing.mode === "always") return true;
  if (routing.mode === "as-needed") {
    return routing.defaultLocale === null ? null : locale !== routing.defaultLocale;
  }
  return routing.mode === "never" ? false : null;
};

const localizePathname = (
  pathname: string,
  locale: string,
  routing: RoutingConfig,
  forcePrefix: boolean | null,
): StaticValue => {
  const isPrefixed = shouldPrefixPathname(pathname, locale, routing, forcePrefix);
  if (isPrefixed === null) {
    return unknownPrimitiveValue("string", `whether "${pathname}" gets a locale prefix`);
  }
  if (!isPrefixed) return primitiveValue(pathname);
  const prefix = getLocalePrefix(locale, routing);
  if (prefix === null) return unknownPrimitiveValue("string", `locale prefix for "${locale}"`);
  return primitiveValue(prefix + (/^\/(\?.*)?$/.test(pathname) ? pathname.slice(1) : pathname));
};

const unprefixPathname = (
  pathname: string,
  locale: string,
  routing: RoutingConfig,
): StaticValue => {
  const prefix = getLocalePrefix(locale, routing);
  if (prefix === null) return unknownPrimitiveValue("string", `locale prefix for "${locale}"`);
  const hasPrefix = (candidate: string): boolean =>
    pathname === candidate || pathname.startsWith(`${candidate}/`);
  const strip = (candidate: string): StaticValue =>
    primitiveValue(pathname.replace(new RegExp(`^${candidate}`), "") || "/");
  if (hasPrefix(prefix)) return strip(prefix);
  const hasCustomPrefixes = routing.mode !== "never" && isNullish(routing.prefixes) !== true;
  if (hasCustomPrefixes && hasPrefix(`/${locale}`)) return strip(`/${locale}`);
  return primitiveValue(pathname);
};

const notSupportedOnServer = (hookName: string): StaticValue =>
  thrownValue(
    `${hookName} is not supported in Server Components`,
    unknownValue(`\`${hookName}\` is not supported in Server Components`),
  );

export const createNextIntlModel = (options: NextIntlModelOptions): NextIntlModel => {
  let requestConfigPath: string | null = null;
  let requestConfig: StaticValue | null = null;
  let requestLocale: StaticValue | null = null;
  const configCache = new Map<string | null, StaticValue>();
  const isLegacy = isLegacyVersion(options.version);

  const getServerConfig = (
    tools: StubRenderTools,
    localeOverride: StaticValue | null,
  ): StaticValue => {
    const overrideLocale = localeOverride === null ? null : knownString(localeOverride);
    if (localeOverride !== null && overrideLocale === null) {
      return unknownValue(`intl config for locale ${describeValue(localeOverride)}`);
    }
    const cached = configCache.get(overrideLocale);
    if (cached) return cached;
    if (requestConfig === null) {
      return unknownValue(
        `next-intl request configuration (${requestConfigPath ?? DEFAULT_REQUEST_CONFIG_PATH}) was not loaded`,
      );
    }
    const requested =
      localeOverride ??
      requestLocale ??
      unknownValue("the X-NEXT-INTL-LOCALE header the next-intl middleware sets");
    const runtimeConfig = tools.callAwaited(requestConfig, [
      objectFromRecord({
        locale: isLegacy ? requested : (localeOverride ?? UNDEFINED_VALUE),
        requestLocale: resolvedPromiseValue(requested),
      }),
    ]);
    const returnedLocale =
      runtimeConfig.kind === "object"
        ? getObjectProperty(runtimeConfig, "locale")
        : UNDEFINED_VALUE;
    const config =
      runtimeConfig.kind === "object"
        ? objectValue([
            ...pickConfig(runtimeConfig).entries,
            {
              kind: "property",
              key: "locale",
              value: isLegacy ? orValue(returnedLocale, requested) : returnedLocale,
            },
            {
              kind: "property",
              key: "timeZone",
              value: orValue(
                getObjectProperty(runtimeConfig, "timeZone"),
                unknownPrimitiveValue("string", "the server's default time zone"),
              ),
            },
          ])
        : runtimeConfig.kind === "unknown" || runtimeConfig.kind === "branch"
          ? runtimeConfig
          : unknownValue(`request configuration is ${describeValue(runtimeConfig)}`);
    configCache.set(overrideLocale, config);
    return config;
  };

  const getConfig = (tools: StubRenderTools): StaticValue => {
    if (tools.environment === "server") return getServerConfig(tools, null);
    const context = tools.readContext(INTL_CONTEXT);
    if (!isUndefined(context)) return context;
    if (tools.environment === null && requestConfig !== null) return getServerConfig(tools, null);
    return thrownValue(
      "no IntlProvider above",
      unknownValue("No intl context found. Have you configured the provider?"),
    );
  };

  const configProperty = (config: StaticValue, key: string): StaticValue => {
    if (config.kind === "object") return getObjectProperty(config, key);
    if (config.kind === "unknown") return config;
    return unknownValue(`intl config is ${describeValue(config)}`);
  };

  const getLocale = (tools: StubRenderTools): StaticValue =>
    configProperty(getConfig(tools), "locale");

  const getMessages = (config: StaticValue): StaticValue => {
    const messages = configProperty(config, "messages");
    return getTruthiness(messages) === false
      ? thrownValue(
          "no messages configured",
          unknownValue("No messages found. Have you configured them correctly?"),
        )
      : messages;
  };

  const localeArgument = (callOptions: StaticValue): StaticValue | null => {
    const locale =
      callOptions.kind === "object" ? getObjectProperty(callOptions, "locale") : UNDEFINED_VALUE;
    return isUndefined(locale) ? null : locale;
  };

  const clientProviderStub = createClientProviderStub(isLegacy);
  const SERVER_PROVIDER_STUB: StubComponent = {
    displayName: "NextIntlClientProvider",
    isServerComponent: true,
    render: (props, tools) => {
      if (tools.environment === "client") return renderClientProvider(props);
      const config = getServerConfig(tools, null);
      const own = (key: string): StaticValue => getObjectProperty(props, key);
      const inferred = objectFromRecord({
        formats: isUndefined(own("formats")) ? configProperty(config, "formats") : own("formats"),
        locale: nullishValue(own("locale"), configProperty(config, "locale")),
        messages: isUndefined(own("messages")) ? getMessages(config) : own("messages"),
        now: nullishValue(own("now"), configProperty(config, "now")),
        timeZone: nullishValue(own("timeZone"), configProperty(config, "timeZone")),
      });
      return element(
        { kind: "stub", stub: clientProviderStub },
        objectValue([...inferred.entries, ...omitProps(props, PROVIDER_INFERRED_PROPS).entries]),
      );
    },
  };

  const getTranslations = nativeFunction(
    "getTranslations",
    ([namespaceOrOptions = UNDEFINED_VALUE], tools) => {
      const namespace =
        namespaceOrOptions.kind === "object"
          ? getObjectProperty(namespaceOrOptions, "namespace")
          : namespaceOrOptions;
      return resolvedPromiseValue(
        translatorValue(getServerConfig(tools, localeArgument(namespaceOrOptions)), namespace),
      );
    },
  );

  const serverConfigGetter = (name: string, key: string): StaticValue =>
    nativeFunction(name, ([callOptions = UNDEFINED_VALUE], tools) => {
      const config = getServerConfig(tools, localeArgument(callOptions));
      return resolvedPromiseValue(
        key === "messages" ? getMessages(config) : configProperty(config, key),
      );
    });

  const hasLocale = nativeFunction(
    "hasLocale",
    ([locales = UNDEFINED_VALUE, candidate = UNDEFINED_VALUE]) => {
      if (!hasDefiniteItems(locales) || !locales.items.every(isKnownString)) {
        return unknownPrimitiveValue("boolean", `locales are ${describeValue(locales)}`);
      }
      if (candidate.kind !== "primitive") {
        return unknownPrimitiveValue("boolean", `candidate locale is ${describeValue(candidate)}`);
      }
      return locales.items.some((locale) => locale.value === candidate.value)
        ? TRUE_VALUE
        : FALSE_VALUE;
    },
  );

  const callNavigation = (
    importedName: string,
    args: StaticValue[],
    tools: StubRenderTools,
  ): StaticValue => {
    const exported = options.navigation(importedName);
    return exported
      ? tools.call(exported, args)
      : unknownValue(`next/navigation ${importedName} is not modeled`);
  };

  const createNavigation = nativeFunction(
    "createNavigation",
    ([routingValue = UNDEFINED_VALUE]) => {
      const routing = toRoutingConfig(routingValue);
      const localeCookie = routing?.localeCookie ?? UNDEFINED_VALUE;

      const getPathname = (
        href: StaticValue,
        locale: StaticValue,
        forcePrefix: boolean | null,
      ): StaticValue => {
        if (routing === null) {
          return unknownPrimitiveValue("string", `routing is ${describeValue(routingValue)}`);
        }
        if (routing.hasPathnames) {
          return unknownPrimitiveValue("string", "localized pathnames are not modeled");
        }
        const pathname =
          href.kind !== "object"
            ? href
            : isNullish(getObjectProperty(href, "query")) === true
              ? getObjectProperty(href, "pathname")
              : unknownPrimitiveValue("string", "href with a query object");
        const pathnameString = knownString(pathname);
        const localeString = knownString(locale);
        if (pathnameString === null || localeString === null) {
          return unknownPrimitiveValue(
            "string",
            `pathname ${describeValue(pathname)} in locale ${describeValue(locale)}`,
          );
        }
        return localizePathname(pathnameString, localeString, routing, forcePrefix);
      };

      const localeChangingLinkStub: StubComponent = {
        displayName: "LocaleChangingLink",
        render: (props) =>
          element(
            { kind: "stub", stub: options.link },
            objectValue([
              { kind: "property", key: "hrefLang", value: getObjectProperty(props, "locale") },
              {
                kind: "property",
                key: "onClick",
                value: nativeFunction("onLinkClick", () => UNDEFINED_VALUE),
              },
              { kind: "property", key: "prefetch", value: FALSE_VALUE },
              ...omitProps(
                props,
                new Set(["curLocale", "linkRef", "locale", "localeCookie", "onClick", "prefetch"]),
              ).entries,
            ]),
          ),
      };

      const baseLinkStub: StubComponent = {
        displayName: "BaseLink",
        tag: ForwardRefTag,
        render: (props, tools) => {
          const locale = getObjectProperty(props, "locale");
          const currentLocale = getLocale(tools);
          const rest = omitProps(props, new Set(["locale", "localeCookie"]));
          const plainLink = (): StaticValue => element({ kind: "stub", stub: options.link }, rest);
          const hasLocaleProp = isNullish(locale) === false;
          if (!hasLocaleProp && isNullish(locale) === true) return plainLink();
          const changingLink = (): StaticValue =>
            element(
              { kind: "stub", stub: localeChangingLinkStub },
              objectValue([
                { kind: "property", key: "curLocale", value: currentLocale },
                { kind: "property", key: "locale", value: locale },
                {
                  kind: "property",
                  key: "localeCookie",
                  value: getObjectProperty(props, "localeCookie"),
                },
                ...rest.entries,
              ]),
            );
          const localeString = knownString(locale);
          const currentString = knownString(currentLocale);
          if (hasLocaleProp && localeString !== null && currentString !== null) {
            return localeString === currentString ? plainLink() : changingLink();
          }
          return branchValue(
            [changingLink(), plainLink()],
            `whether Link's locale ${describeValue(locale)} differs from the current ${describeValue(currentLocale)}`,
            null,
            hasLocaleProp ? 0 : 1,
          );
        },
      };

      const linkStub: StubComponent = {
        displayName: "Link",
        tag: ForwardRefTag,
        isServerComponent: true,
        render: (props, tools) => {
          const href = getObjectProperty(props, "href");
          const locale = getObjectProperty(props, "locale");
          const pathname = href.kind === "object" ? getObjectProperty(href, "pathname") : href;
          const pathnameString = knownString(pathname);
          const isLocalizable =
            pathnameString !== null
              ? isLocalizableHref(pathnameString)
              : pathname.kind === "primitive"
                ? false
                : null;
          const hasLocaleProp = isNullish(locale);
          const localizedPathname = (): StaticValue => {
            if (isLocalizable === false) return pathname;
            if (isLocalizable === null) {
              return unknownPrimitiveValue("string", `href is ${describeValue(pathname)}`);
            }
            const targetLocale =
              hasLocaleProp === true
                ? getLocale(tools)
                : hasLocaleProp === false
                  ? locale
                  : orValue(locale, getLocale(tools));
            return getPathname(href, targetLocale, hasLocaleProp === false ? true : null);
          };
          const finalHref =
            href.kind === "object"
              ? objectValue([
                  ...href.entries.filter(
                    (entry) => entry.kind !== "property" || entry.key !== "pathname",
                  ),
                  { kind: "property", key: "pathname", value: localizedPathname() },
                ])
              : localizedPathname();
          return element(
            { kind: "stub", stub: baseLinkStub },
            objectValue([
              { kind: "property", key: "href", value: finalHref },
              { kind: "property", key: "locale", value: locale },
              { kind: "property", key: "localeCookie", value: localeCookie },
              ...omitProps(props, new Set(["href", "locale"])).entries,
            ]),
          );
        },
      };

      const usePathname = nativeFunction("usePathname", (_args, tools) => {
        if (tools.environment === "server") return notSupportedOnServer("usePathname");
        const pathname = callNavigation("usePathname", [], tools);
        if (isNullish(pathname) === true) return pathname;
        if (routing === null) {
          return unknownPrimitiveValue("string", `routing is ${describeValue(routingValue)}`);
        }
        if (routing.hasPathnames) {
          return unknownPrimitiveValue("string", "localized pathnames are not modeled");
        }
        const locale = getLocale(tools);
        const pathnameString = knownString(pathname);
        const localeString = knownString(locale);
        if (pathnameString === null || localeString === null) {
          return unknownPrimitiveValue(
            "string",
            `pathname ${describeValue(pathname)} in locale ${describeValue(locale)}`,
          );
        }
        return unprefixPathname(pathnameString, localeString, routing);
      });

      const useRouter = nativeFunction("useRouter", (_args, tools) => {
        if (tools.environment === "server") return notSupportedOnServer("useRouter");
        const router = callNavigation("useRouter", [], tools);
        const currentLocale = getLocale(tools);
        const navigate = (name: string): StaticValue =>
          nativeFunction(
            name,
            ([href = UNDEFINED_VALUE, navigateOptions = UNDEFINED_VALUE], handlerTools) => {
              const nextLocale =
                navigateOptions.kind === "object"
                  ? getObjectProperty(navigateOptions, "locale")
                  : UNDEFINED_VALUE;
              const target = getPathname(
                href,
                orValue(nextLocale, currentLocale),
                isNullish(nextLocale) === false ? true : null,
              );
              return router.kind === "object"
                ? handlerTools.call(getObjectProperty(router, name), [target])
                : UNDEFINED_VALUE;
            },
          );
        return objectValue([
          { kind: "spread", value: router },
          { kind: "property", key: "push", value: navigate("push") },
          { kind: "property", key: "replace", value: navigate("replace") },
          { kind: "property", key: "prefetch", value: navigate("prefetch") },
        ]);
      });

      const redirectFunction = (name: string): StaticValue =>
        nativeFunction(name, ([args = UNDEFINED_VALUE, ...rest], tools) => {
          const href = args.kind === "object" ? getObjectProperty(args, "href") : args;
          const locale = localeArgument(args) ?? getLocale(tools);
          return callNavigation(name, [getPathname(href, locale, null), ...rest], tools);
        });

      return objectFromRecord({
        Link: stubValue(linkStub),
        redirect: redirectFunction("redirect"),
        permanentRedirect: redirectFunction("permanentRedirect"),
        usePathname,
        useRouter,
        getPathname: nativeFunction("getPathname", ([args = UNDEFINED_VALUE]) => {
          if (args.kind !== "object") {
            return unknownPrimitiveValue("string", `getPathname(${describeValue(args)})`);
          }
          const forcePrefix = getObjectProperty(args, "forcePrefix");
          return getPathname(
            getObjectProperty(args, "href"),
            getObjectProperty(args, "locale"),
            forcePrefix.kind === "primitive" && typeof forcePrefix.value === "boolean"
              ? forcePrefix.value
              : null,
          );
        }),
      });
    },
  );

  const createNextIntlPlugin = nativeFunction(
    "createNextIntlPlugin",
    ([pathOrOptions = UNDEFINED_VALUE]) => {
      const configured =
        pathOrOptions.kind === "object"
          ? getObjectProperty(pathOrOptions, "requestConfig")
          : pathOrOptions;
      requestConfigPath = knownString(configured) ?? DEFAULT_REQUEST_CONFIG_PATH;
      return nativeFunction("withNextIntl", ([nextConfig = UNDEFINED_VALUE]) =>
        isUndefined(nextConfig) ? objectValue() : nextConfig,
      );
    },
  );

  const createTranslator = nativeFunction("createTranslator", ([config = UNDEFINED_VALUE]) =>
    config.kind === "object"
      ? translatorValue(pickConfig(config), getObjectProperty(config, "namespace"))
      : unknownValue(`createTranslator(${describeValue(config)})`),
  );

  const sharedValue = (importedName: string): StaticValue | null => {
    switch (importedName) {
      case "useTranslations":
        return nativeFunction("useTranslations", ([namespace = UNDEFINED_VALUE], tools) =>
          translatorValue(getConfig(tools), namespace),
        );
      case "useLocale":
        return nativeFunction("useLocale", (_args, tools) => getLocale(tools));
      case "useMessages":
        return nativeFunction("useMessages", (_args, tools) => getMessages(getConfig(tools)));
      case "useTimeZone":
        return nativeFunction("useTimeZone", (_args, tools) =>
          configProperty(getConfig(tools), "timeZone"),
        );
      case "useNow":
        return nativeFunction("useNow", (_args, tools) =>
          orValue(
            configProperty(getConfig(tools), "now"),
            unknownValue("the current time, `new Date()`"),
          ),
        );
      case "hasLocale":
        return hasLocale;
      case "createTranslator":
        return createTranslator;
      case "IntlProvider":
        return stubValue(INTL_PROVIDER_STUB);
      default:
        return null;
    }
  };

  const serverValue = (importedName: string): StaticValue | null => {
    switch (importedName) {
      case "getRequestConfig":
        return nativeFunction(
          "getRequestConfig",
          ([createRequestConfig = UNDEFINED_VALUE]) => createRequestConfig,
        );
      case "getTranslations":
        return getTranslations;
      case "getLocale":
        return serverConfigGetter(importedName, "locale");
      case "getFormats":
        return serverConfigGetter(importedName, "formats");
      case "getNow":
        return serverConfigGetter(importedName, "now");
      case "getTimeZone":
        return serverConfigGetter(importedName, "timeZone");
      case "getMessages":
        return serverConfigGetter(importedName, "messages");
      case "setRequestLocale":
      case "unstable_setRequestLocale":
        return nativeFunction(importedName, ([locale = UNDEFINED_VALUE]) => {
          requestLocale = locale;
          return UNDEFINED_VALUE;
        });
      default:
        return null;
    }
  };

  const externalValues: ExternalValueProvider = (specifier, importedName) => {
    switch (specifier) {
      case "next-intl":
        return importedName === "NextIntlClientProvider"
          ? stubValue(SERVER_PROVIDER_STUB)
          : sharedValue(importedName);
      case "use-intl":
      case "use-intl/core":
      case "use-intl/react":
        return sharedValue(importedName);
      case "next-intl/server":
        return serverValue(importedName);
      case "next-intl/navigation":
        return importedName === "createNavigation" ? createNavigation : null;
      case "next-intl/routing":
        return importedName === "defineRouting"
          ? nativeFunction("defineRouting", ([routing = UNDEFINED_VALUE]) => routing)
          : null;
      case "next-intl/plugin":
        return importedName === "default" || importedName === "createNextIntlPlugin"
          ? createNextIntlPlugin
          : null;
      default:
        return null;
    }
  };

  return {
    externalValues,
    getRequestConfigPath: () => requestConfigPath,
    setRequestConfig: (config) => {
      requestConfig = config;
      configCache.clear();
    },
  };
};
