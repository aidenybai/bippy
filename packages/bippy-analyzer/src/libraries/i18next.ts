import { resolvedPromiseValue } from "../evaluate/promises.js";
import { element, nativeFunction, stubValue } from "../evaluate/stubs.js";
import {
  FALSE_VALUE,
  NULL_VALUE,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  getObjectProperty,
  isKnownString,
  isUndefinedValue,
  objectFromRecord,
  primitiveValue,
  unknownPrimitiveValue,
} from "../evaluate/values.js";
import type {
  ContextDefinition,
  LibraryRun,
  LibraryValueProvider,
  StaticObjectValue,
  StaticValue,
  StubComponent,
} from "../types.js";

export const I18NEXT_PACKAGES = ["i18next", "react-i18next"];

interface I18nextInstanceState {
  resources: StaticValue;
  language: StaticValue;
  fallbackLanguage: StaticValue;
  defaultNamespace: StaticValue;
  keySeparator: string | null;
}

interface I18nextModel {
  getValue: (specifier: string, importedName: string) => StaticValue | null;
}

const I18NEXT_CONTEXT: ContextDefinition = {
  name: "I18nextContext",
  displayName: null,
  defaultValue: NULL_VALUE,
  location: null,
};

const getOption = (options: StaticValue, name: string): StaticValue =>
  options.kind === "object" ? getObjectProperty(options, name) : UNDEFINED_VALUE;

const getFirstValue = (value: StaticValue): StaticValue =>
  value.kind === "list" ? (value.items[0] ?? UNDEFINED_VALUE) : value;

const getLanguageCandidates = (
  language: StaticValue,
  fallbackLanguage: StaticValue,
): StaticValue[] => {
  const candidates: StaticValue[] = [];
  const addCandidate = (candidate: StaticValue): void => {
    if (!isKnownString(candidate)) {
      if (!isUndefinedValue(candidate)) candidates.push(candidate);
      return;
    }
    if (
      !candidates.some((existing) => isKnownString(existing) && existing.value === candidate.value)
    ) {
      candidates.push(candidate);
    }
    const baseLanguage = candidate.value.split("-")[0];
    if (
      baseLanguage !== candidate.value &&
      !candidates.some((existing) => isKnownString(existing) && existing.value === baseLanguage)
    ) {
      candidates.push(primitiveValue(baseLanguage));
    }
  };
  addCandidate(getFirstValue(language));
  addCandidate(getFirstValue(fallbackLanguage));
  return candidates;
};

const getNestedValue = (root: StaticValue, segments: readonly string[]): StaticValue => {
  let value = root;
  for (const segment of segments) {
    if (value.kind !== "object") {
      return isUndefinedValue(value)
        ? UNDEFINED_VALUE
        : unknownPrimitiveValue("string", "translation from a dynamic resource catalog");
    }
    value = getObjectProperty(value, segment);
  }
  return value;
};

const getInterpolation = (translation: string, options: StaticValue): StaticValue => {
  const pattern = /\{\{\s*([^},\s]+)[^}]*\}\}/gu;
  let result = "";
  let offset = 0;
  for (const match of translation.matchAll(pattern)) {
    const index = match.index;
    const name = match[1];
    result += translation.slice(offset, index);
    const value = getOption(options, name);
    if (
      value.kind !== "primitive" ||
      (typeof value.value !== "string" &&
        typeof value.value !== "number" &&
        typeof value.value !== "boolean")
    ) {
      return unknownPrimitiveValue("string", `translation interpolation "${name}"`);
    }
    result += String(value.value);
    offset = index + match[0].length;
  }
  return primitiveValue(result + translation.slice(offset));
};

const getTranslation = (
  state: I18nextInstanceState,
  keyValue: StaticValue,
  options: StaticValue,
  fixedLanguage: StaticValue,
  fixedNamespace: StaticValue,
  keyPrefix: StaticValue,
): StaticValue => {
  if (!isKnownString(keyValue)) {
    return unknownPrimitiveValue("string", "translation of a dynamic key");
  }
  const optionLanguage = getOption(options, "lng");
  const language = isUndefinedValue(optionLanguage)
    ? isUndefinedValue(fixedLanguage)
      ? state.language
      : fixedLanguage
    : optionLanguage;
  const optionNamespace = getFirstValue(getOption(options, "ns"));
  let namespaceValue = isUndefinedValue(optionNamespace)
    ? isUndefinedValue(fixedNamespace)
      ? getFirstValue(state.defaultNamespace)
      : fixedNamespace
    : optionNamespace;
  let key = keyValue.value;
  const namespaceSeparator = key.indexOf(":");
  if (namespaceSeparator >= 0) {
    namespaceValue = primitiveValue(key.slice(0, namespaceSeparator));
    key = key.slice(namespaceSeparator + 1);
  }
  if (isKnownString(keyPrefix) && keyPrefix.value) {
    key = `${keyPrefix.value}${state.keySeparator ?? "."}${key}`;
  }
  const optionCount = getOption(options, "count");
  const keyCandidates =
    typeof getOption(options, "keySeparator").value === "boolean" &&
    getOption(options, "keySeparator").value === false
      ? [key]
      : typeof optionCount.value === "number"
        ? [
            `${key}_${optionCount.value === 0 ? "zero" : optionCount.value === 1 ? "one" : "other"}`,
            key,
          ]
        : [key];
  const namespaceName = isKnownString(namespaceValue) ? namespaceValue.value : "translation";
  for (const languageCandidate of getLanguageCandidates(language, state.fallbackLanguage)) {
    if (!isKnownString(languageCandidate)) {
      return unknownPrimitiveValue("string", "translation from a dynamic language");
    }
    for (const keyCandidate of keyCandidates) {
      const segments =
        state.keySeparator === null ? [keyCandidate] : keyCandidate.split(state.keySeparator);
      const value = getNestedValue(state.resources, [
        languageCandidate.value,
        namespaceName,
        ...segments,
      ]);
      if (isUndefinedValue(value)) continue;
      return isKnownString(value)
        ? getInterpolation(value.value, options)
        : unknownPrimitiveValue("string", `translation of "${key}"`);
    }
  }
  const defaultValue = getOption(options, "defaultValue");
  if (isKnownString(defaultValue)) return getInterpolation(defaultValue.value, options);
  return primitiveValue(key);
};

const createI18nextInstance = (): StaticObjectValue => {
  const state: I18nextInstanceState = {
    resources: UNDEFINED_VALUE,
    language: UNDEFINED_VALUE,
    fallbackLanguage: primitiveValue("dev"),
    defaultNamespace: primitiveValue("translation"),
    keySeparator: ".",
  };
  let instance = objectFromRecord({});
  const translate = (
    key: StaticValue,
    options = UNDEFINED_VALUE,
    fixedLanguage = UNDEFINED_VALUE,
    fixedNamespace = UNDEFINED_VALUE,
    keyPrefix = UNDEFINED_VALUE,
  ): StaticValue =>
    getTranslation(
      state,
      key,
      isKnownString(options) ? objectFromRecord({ defaultValue: options }) : options,
      fixedLanguage,
      fixedNamespace,
      keyPrefix,
    );
  const t = nativeFunction("t", ([key = UNDEFINED_VALUE, options]) => translate(key, options));
  instance = objectFromRecord({
    language: state.language,
    resolvedLanguage: state.language,
    isInitialized: FALSE_VALUE,
    t,
    getFixedT: nativeFunction(
      "getFixedT",
      ([language = UNDEFINED_VALUE, namespace = UNDEFINED_VALUE, keyPrefix = UNDEFINED_VALUE]) =>
        nativeFunction("fixedT", ([key = UNDEFINED_VALUE, options]) =>
          translate(key, options, language, getFirstValue(namespace), keyPrefix),
        ),
    ),
    use: nativeFunction("use", () => instance),
    init: nativeFunction("init", ([options = UNDEFINED_VALUE]) => {
      const resources = getOption(options, "resources");
      const language = getOption(options, "lng");
      const fallbackLanguage = getOption(options, "fallbackLng");
      const defaultNamespace = getOption(options, "defaultNS");
      const keySeparator = getOption(options, "keySeparator");
      if (!isUndefinedValue(resources)) state.resources = resources;
      if (!isUndefinedValue(language)) state.language = language;
      if (!isUndefinedValue(fallbackLanguage)) state.fallbackLanguage = fallbackLanguage;
      if (!isUndefinedValue(defaultNamespace)) state.defaultNamespace = defaultNamespace;
      if (keySeparator.kind === "primitive") {
        if (keySeparator.value === false) state.keySeparator = null;
        if (typeof keySeparator.value === "string") state.keySeparator = keySeparator.value;
      }
      instance.entries = objectFromRecord({
        language: state.language,
        resolvedLanguage: state.language,
        isInitialized: TRUE_VALUE,
        t,
      }).entries.concat(
        instance.entries.filter(
          (entry) =>
            entry.kind !== "property" ||
            !["language", "resolvedLanguage", "isInitialized", "t"].includes(entry.key),
        ),
      );
      return resolvedPromiseValue(t);
    }),
    changeLanguage: nativeFunction("changeLanguage", ([language = UNDEFINED_VALUE]) => {
      state.language = language;
      return resolvedPromiseValue(t);
    }),
    exists: nativeFunction("exists", ([key = UNDEFINED_VALUE, options]) =>
      isKnownString(translate(key, options)) ? TRUE_VALUE : FALSE_VALUE,
    ),
    hasLoadedNamespace: nativeFunction("hasLoadedNamespace", () => TRUE_VALUE),
    loadNamespaces: nativeFunction("loadNamespaces", () => resolvedPromiseValue(UNDEFINED_VALUE)),
    loadLanguages: nativeFunction("loadLanguages", () => resolvedPromiseValue(UNDEFINED_VALUE)),
    on: nativeFunction("on", () => instance),
    off: nativeFunction("off", () => instance),
  });
  return instance;
};

const createI18nextModel = (): I18nextModel => {
  const globalInstance = createI18nextInstance();
  const createInstance = nativeFunction("createInstance", () => createI18nextInstance());
  globalInstance.entries.push({ kind: "property", key: "createInstance", value: createInstance });
  const providerStub: StubComponent = {
    displayName: "I18nextProvider",
    render: (props) =>
      element(
        { kind: "context-provider", context: I18NEXT_CONTEXT, displayName: null },
        objectFromRecord({
          value: objectFromRecord({
            i18n: getObjectProperty(props, "i18n"),
            defaultNS: getObjectProperty(props, "defaultNS"),
          }),
          children: getObjectProperty(props, "children"),
        }),
      ),
  };
  const useTranslation = nativeFunction("useTranslation", ([namespace], tools) => {
    const context = tools.readContext(I18NEXT_CONTEXT);
    const contextualInstance =
      context.kind === "object" ? getObjectProperty(context, "i18n") : UNDEFINED_VALUE;
    const activeInstance = isUndefinedValue(contextualInstance)
      ? globalInstance
      : contextualInstance;
    const contextNamespace =
      context.kind === "object" ? getObjectProperty(context, "defaultNS") : UNDEFINED_VALUE;
    const activeNamespace = namespace ?? contextNamespace;
    const fixedT = getObjectProperty(activeInstance, "getFixedT");
    const t = tools.call(fixedT, [UNDEFINED_VALUE, activeNamespace]);
    return objectFromRecord({ t, i18n: activeInstance, ready: TRUE_VALUE });
  });
  const reactPlugin = objectFromRecord({
    type: primitiveValue("3rdParty"),
    init: nativeFunction("init", () => UNDEFINED_VALUE),
  });
  return {
    getValue: (specifier, importedName) => {
      if (specifier === "i18next") {
        switch (importedName) {
          case "default":
          case "i18next":
            return globalInstance;
          case "createInstance":
            return createInstance;
          case "t":
          case "getFixedT":
          case "use":
          case "init":
          case "changeLanguage":
            return getObjectProperty(globalInstance, importedName);
          default:
            return null;
        }
      }
      if (specifier !== "react-i18next") return null;
      switch (importedName) {
        case "initReactI18next":
          return reactPlugin;
        case "I18nextProvider":
          return stubValue(providerStub);
        case "useTranslation":
          return useTranslation;
        case "getI18n":
          return nativeFunction("getI18n", () => globalInstance);
        default:
          return null;
      }
    },
  };
};

const models = new WeakMap<LibraryRun, I18nextModel>();

export const i18nextValue: LibraryValueProvider = (specifier, importedName, run) => {
  let model = models.get(run);
  if (!model) {
    model = createI18nextModel();
    models.set(run, model);
  }
  return model.getValue(specifier, importedName);
};
