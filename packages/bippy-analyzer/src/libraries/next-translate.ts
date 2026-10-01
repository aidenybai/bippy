import { element, nativeFunction, stubValue } from "../evaluate/stubs.js";
import {
  UNDEFINED_VALUE,
  getObjectProperty,
  isUndefinedValue,
  listValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
} from "../evaluate/values.js";
import type {
  ContextDefinition,
  LibraryValueProvider,
  ModeledExports,
  StaticElementValue,
  StaticObjectValue,
  StaticValue,
  StubComponent,
} from "../types.js";

export const NEXT_TRANSLATE_PACKAGES = ["next-translate"];
export const NEXT_TRANSLATE_MODELED_EXPORTS: ModeledExports = {
  "next-translate/Trans": ["default"],
  "next-translate/useTranslation": ["default"],
};

const NEXT_TRANSLATE_CONTEXT: ContextDefinition = {
  name: "NextTranslationContext",
  displayName: "NextTranslationContext",
  defaultValue: UNDEFINED_VALUE,
  location: null,
};

const getString = (value: StaticValue): string | null =>
  value.kind === "primitive" && typeof value.value === "string" ? value.value : null;

const getNestedProperty = (value: StaticValue, path: string): StaticValue => {
  let current = value;
  for (const segment of path.split(".")) {
    if (current.kind !== "object") return UNDEFINED_VALUE;
    current = getObjectProperty(current, segment);
  }
  return current;
};

const getPluralValue = (value: StaticValue, variables: StaticValue): StaticValue => {
  if (value.kind !== "object") return value;
  const count =
    variables.kind === "object" ? getObjectProperty(variables, "count") : UNDEFINED_VALUE;
  if (count.kind !== "primitive" || typeof count.value !== "number") return UNDEFINED_VALUE;
  const exact = getObjectProperty(value, String(count.value));
  if (!isUndefinedValue(exact)) return exact;
  const category = getObjectProperty(value, count.value === 1 ? "one" : "other");
  return category;
};

const interpolate = (text: string, variables: StaticValue): StaticValue => {
  const pattern = /{{\s*([^},\s]+)[^}]*}}/g;
  let offset = 0;
  let result = "";
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    result += text.slice(offset, match.index);
    const value =
      variables.kind === "object" ? getObjectProperty(variables, match[1]) : UNDEFINED_VALUE;
    if (
      value.kind !== "primitive" ||
      (typeof value.value !== "string" &&
        typeof value.value !== "number" &&
        typeof value.value !== "boolean")
    ) {
      return unknownPrimitiveValue("string", `next-translate interpolation "${match[1]}"`);
    }
    result += String(value.value);
    offset = match.index + match[0].length;
  }
  return primitiveValue(result + text.slice(offset));
};

const getTranslation = (
  context: StaticValue,
  namespace: string,
  key: string,
  variables: StaticValue,
): StaticValue => {
  if (context.kind !== "object") return UNDEFINED_VALUE;
  const namespaces = getObjectProperty(context, "namespaces");
  if (namespaces.kind !== "object") return UNDEFINED_VALUE;
  const resource = getNestedProperty(getObjectProperty(namespaces, namespace), key);
  const selected = getPluralValue(resource, variables);
  const text = getString(selected);
  return text === null ? UNDEFINED_VALUE : interpolate(text, variables);
};

const withChildren = (
  template: StaticElementValue,
  children: StaticValue,
  key: number,
): StaticElementValue =>
  element(
    template.type,
    objectValue([
      ...template.props.entries.filter(
        (entry) => entry.kind !== "property" || entry.key !== "children",
      ),
      { kind: "property", key: "children", value: children },
    ]),
    primitiveValue(key),
  );

const getTranslationComponent = (components: StaticValue, name: string): StaticValue => {
  if (components.kind === "object") return getObjectProperty(components, name);
  if (components.kind !== "list" || !/^\d+$/.test(name)) return UNDEFINED_VALUE;
  return components.items[Number.parseInt(name, 10)] ?? UNDEFINED_VALUE;
};

const renderFormattedElements = (text: string, components: StaticValue): StaticValue => {
  const tagPattern = /<(\w+) *>(.*?)<\/\1 *>|<(\w+) *\/>/g;
  const normalizedText = text.replace(/(?:\r\n|\r|\n)/g, "");
  const rendered: StaticValue[] = [];
  let offset = 0;
  let key = 0;
  for (
    let match = tagPattern.exec(normalizedText);
    match;
    match = tagPattern.exec(normalizedText)
  ) {
    if (match.index > offset)
      rendered.push(primitiveValue(normalizedText.slice(offset, match.index)));
    const name = match[1] ?? match[3];
    const template = getTranslationComponent(components, name);
    const childText = match[2] ?? "";
    const children =
      childText.length > 0
        ? renderFormattedElements(childText, components)
        : template.kind === "element"
          ? getObjectProperty(template.props, "children")
          : UNDEFINED_VALUE;
    const component =
      template.kind === "element" ? template : element({ kind: "fragment" }, objectValue());
    rendered.push(withChildren(component, children, key));
    key++;
    offset = match.index + match[0].length;
  }
  if (rendered.length === 0) return primitiveValue(normalizedText);
  if (offset < normalizedText.length) rendered.push(primitiveValue(normalizedText.slice(offset)));
  return listValue(rendered);
};

const renderTranslation = (text: string, components: StaticValue): StaticValue => {
  if (
    components.kind !== "object" &&
    (components.kind !== "list" || components.items.length === 0)
  ) {
    return primitiveValue(text);
  }
  return renderFormattedElements(text, components);
};

const renderTrans = (props: StaticObjectValue, context: StaticValue): StaticValue => {
  const i18nKey = getString(getObjectProperty(props, "i18nKey"));
  if (i18nKey === null) return unknownPrimitiveValue("string", "dynamic next-translate key");
  const separator = i18nKey.indexOf(":");
  const namespace = separator === -1 ? "common" : i18nKey.slice(0, separator);
  const key = separator === -1 ? i18nKey : i18nKey.slice(separator + 1);
  const variables = getObjectProperty(props, "values");
  const translation = getTranslation(context, namespace, key, variables);
  const fallback = getObjectProperty(props, "defaultTrans");
  const text = getString(isUndefinedValue(translation) ? fallback : translation);
  if (text === null) return primitiveValue(i18nKey);
  return renderTranslation(text, getObjectProperty(props, "components"));
};

const TRANS_STUB: StubComponent = {
  displayName: "Trans",
  render: (props, tools) => renderTrans(props, tools.readContext(NEXT_TRANSLATE_CONTEXT)),
};

const useTranslation = nativeFunction("useTranslation", ([namespace], tools) => {
  const context = tools.readContext(NEXT_TRANSLATE_CONTEXT);
  const activeNamespace = getString(namespace ?? UNDEFINED_VALUE) ?? "common";
  const translate = nativeFunction("t", ([key, variables = objectValue()]) => {
    const keyName = getString(key ?? UNDEFINED_VALUE);
    if (keyName === null) return unknownPrimitiveValue("string", "dynamic next-translate key");
    const translated = getTranslation(context, activeNamespace, keyName, variables);
    return isUndefinedValue(translated) ? primitiveValue(keyName) : translated;
  });
  return objectFromRecord({
    t: translate,
    lang:
      context.kind === "object"
        ? getObjectProperty(context, "lang")
        : unknownPrimitiveValue("string", "next-translate language"),
  });
});

export const provideNextTranslations = (
  pageProps: StaticValue,
  children: StaticValue,
): StaticValue => {
  if (pageProps.kind !== "object") return children;
  const namespaces = getObjectProperty(pageProps, "__namespaces");
  if (isUndefinedValue(namespaces)) return children;
  return element(
    {
      kind: "context-provider",
      context: NEXT_TRANSLATE_CONTEXT,
      displayName: NEXT_TRANSLATE_CONTEXT.displayName,
    },
    objectFromRecord({
      value: objectFromRecord({
        namespaces,
        lang: getObjectProperty(pageProps, "__lang"),
      }),
      children,
    }),
  );
};

export const nextTranslateValue: LibraryValueProvider = (specifier, importedName) => {
  if (importedName !== "default") return null;
  if (specifier === "next-translate/Trans") return stubValue(TRANS_STUB);
  return specifier === "next-translate/useTranslation" ? useTranslation : null;
};
