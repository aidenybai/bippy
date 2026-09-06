import {
  branchValue,
  getObjectProperty,
  mapValue,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction } from "../frameworks/stubs.js";
import type { ExternalValueProvider, StaticValue } from "../types.js";

// `new Jed({domain, locale_data})` looks translations up in
// `locale_data[domain][key]` and falls back to the English keys it was given,
// so a lookup is exact whenever the catalog is a known object.

export const JED_PACKAGES = ["jed"];

const CONTEXT_DELIMITER = String.fromCharCode(4);

const englishPlural = (
  singular: StaticValue,
  plural: StaticValue,
  count: StaticValue | undefined,
): StaticValue => {
  if (count === undefined) return singular;
  if (count.kind === "primitive" && typeof count.value === "number") {
    return count.value === 1 ? singular : plural;
  }
  return branchValue([singular, plural], "plural form of the translated count");
};

const translate = (
  catalog: StaticValue,
  singular: StaticValue,
  plural: StaticValue,
  count: StaticValue | undefined,
): StaticValue => {
  if (singular.kind !== "primitive" || typeof singular.value !== "string") {
    return unknownPrimitiveValue("string", "translation of a dynamic key");
  }
  if (catalog.kind !== "object") {
    return unknownPrimitiveValue("string", "translation from an unknown catalog");
  }
  const entry = getObjectProperty(catalog, singular.value);
  if (entry.kind === "primitive" && entry.value === undefined) {
    return englishPlural(singular, plural, count);
  }
  if (entry.kind !== "list" || entry.items.some((item) => item.kind !== "primitive")) {
    return unknownPrimitiveValue("string", `translation of "${singular.value}"`);
  }
  const chooseForm = (form: StaticValue): StaticValue =>
    form.kind === "primitive" && form.value ? form : englishPlural(singular, plural, count);
  if (count === undefined) return chooseForm(entry.items[0] ?? UNDEFINED_VALUE);
  return branchValue(entry.items.map(chooseForm), "plural form of the translated count");
};

const contextKey = (context: StaticValue | undefined, singular: StaticValue): StaticValue => {
  if (context === undefined || (context.kind === "primitive" && !context.value)) return singular;
  if (
    context.kind === "primitive" &&
    singular.kind === "primitive" &&
    typeof singular.value === "string"
  ) {
    return primitiveValue(`${String(context.value)}${CONTEXT_DELIMITER}${singular.value}`);
  }
  return unknownPrimitiveValue("string", "translation key with a dynamic context");
};

const createInstance = (options: StaticValue | undefined): StaticValue => {
  const domain =
    options?.kind === "object" ? getObjectProperty(options, "domain") : UNDEFINED_VALUE;
  const localeData =
    options?.kind === "object"
      ? getObjectProperty(options, "locale_data")
      : unknownValue("locale data of a Jed instance built from dynamic options");
  const catalogFor = (requested: StaticValue | undefined): StaticValue => {
    const domainValue =
      requested === undefined || (requested.kind === "primitive" && !requested.value)
        ? domain
        : requested;
    const domainName =
      domainValue.kind === "primitive" && typeof domainValue.value === "string"
        ? domainValue.value
        : domainValue.kind === "primitive" && domainValue.value === undefined
          ? "messages"
          : null;
    if (domainName === null) return unknownValue("translation catalog of a dynamic domain");
    return mapValue(localeData, (data) =>
      data.kind === "object"
        ? getObjectProperty(data, domainName)
        : unknownValue("translation catalog from unknown locale data"),
    );
  };
  const lookup = (
    requestedDomain: StaticValue | undefined,
    context: StaticValue | undefined,
    singular: StaticValue,
    plural: StaticValue | undefined,
    count: StaticValue | undefined,
  ): StaticValue =>
    mapValue(catalogFor(requestedDomain), (catalog) =>
      translate(catalog, contextKey(context, singular), plural ?? singular, count),
    );
  return objectFromRecord({
    options: options ?? UNDEFINED_VALUE,
    textdomain: nativeFunction("textdomain", () => domain),
    gettext: nativeFunction("gettext", ([key]) =>
      lookup(undefined, undefined, key ?? UNDEFINED_VALUE, undefined, undefined),
    ),
    dgettext: nativeFunction("dgettext", ([requestedDomain, key]) =>
      lookup(requestedDomain, undefined, key ?? UNDEFINED_VALUE, undefined, undefined),
    ),
    dcgettext: nativeFunction("dcgettext", ([requestedDomain, key]) =>
      lookup(requestedDomain, undefined, key ?? UNDEFINED_VALUE, undefined, undefined),
    ),
    ngettext: nativeFunction("ngettext", ([singular, plural, count]) =>
      lookup(undefined, undefined, singular ?? UNDEFINED_VALUE, plural, count),
    ),
    dngettext: nativeFunction("dngettext", ([requestedDomain, singular, plural, count]) =>
      lookup(requestedDomain, undefined, singular ?? UNDEFINED_VALUE, plural, count),
    ),
    dcngettext: nativeFunction("dcngettext", ([requestedDomain, singular, plural, count]) =>
      lookup(requestedDomain, undefined, singular ?? UNDEFINED_VALUE, plural, count),
    ),
    pgettext: nativeFunction("pgettext", ([context, key]) =>
      lookup(undefined, context, key ?? UNDEFINED_VALUE, undefined, undefined),
    ),
    dpgettext: nativeFunction("dpgettext", ([requestedDomain, context, key]) =>
      lookup(requestedDomain, context, key ?? UNDEFINED_VALUE, undefined, undefined),
    ),
    dcpgettext: nativeFunction("dcpgettext", ([requestedDomain, context, key]) =>
      lookup(requestedDomain, context, key ?? UNDEFINED_VALUE, undefined, undefined),
    ),
    npgettext: nativeFunction("npgettext", ([context, singular, plural, count]) =>
      lookup(undefined, context, singular ?? UNDEFINED_VALUE, plural, count),
    ),
    dnpgettext: nativeFunction(
      "dnpgettext",
      ([requestedDomain, context, singular, plural, count]) =>
        lookup(requestedDomain, context, singular ?? UNDEFINED_VALUE, plural, count),
    ),
    dcnpgettext: nativeFunction(
      "dcnpgettext",
      ([requestedDomain, context, singular, plural, count]) =>
        lookup(requestedDomain, context, singular ?? UNDEFINED_VALUE, plural, count),
    ),
  });
};

export const jedValue: ExternalValueProvider = (specifier, importedName) => {
  if (!JED_PACKAGES.includes(specifier) || importedName !== "default") return null;
  return nativeFunction("Jed", ([options]) => createInstance(options));
};
