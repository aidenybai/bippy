import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  getKnownObjectKeys,
  getObjectProperty,
  isNullish,
  listValue,
  objectFromRecord,
  objectValue,
  omitObjectKeys,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import type {
  StaticElementValue,
  StaticObjectValue,
  StaticPrimitive,
  StaticValue,
} from "../types.js";
import { element } from "../evaluate/stubs.js";

// `<Meta>` and `<Links>` in React Router framework mode
// (`lib/dom/ssr/components`): both turn the matched routes' `meta()` / `links()`
// descriptors into head elements keyed by `JSON.stringify` of the descriptor.

/** Descriptors framework mode collects once the routes are matched. */
export interface FrameworkDocument {
  /** `meta.flat()` of the leaf route (inherited from the nearest ancestor with `meta`). */
  meta: StaticValue | null;
  /** `links()` of every match, root first, de-duplicated by key. */
  links: StaticValue | null;
}

const META_TAG_NAMES = new Set(["meta", "link"]);

const hostElement = (
  tagName: string,
  props: StaticObjectValue,
  key: StaticValue,
): StaticElementValue => element({ kind: "host", tagName }, props, key);

const toPrimitiveRecord = (object: StaticObjectValue): Record<string, StaticPrimitive> | null => {
  const record: Record<string, StaticPrimitive> = {};
  for (const entry of object.entries) {
    if (entry.kind !== "property" || entry.value.kind !== "primitive") return null;
    record[entry.key] = entry.value.value;
  }
  return record;
};

const jsonKey = (object: StaticObjectValue, sortKeys: boolean): StaticValue => {
  const record = toPrimitiveRecord(object);
  if (!record) {
    return unknownPrimitiveValue("string", "key is JSON.stringify of a dynamic descriptor");
  }
  const keys = Object.keys(record);
  if (sortKeys) keys.sort();
  return primitiveValue(JSON.stringify(Object.fromEntries(keys.map((key) => [key, record[key]]))));
};

const stringOf = (value: StaticValue): StaticValue =>
  value.kind === "primitive"
    ? primitiveValue(String(value.value))
    : unknownPrimitiveValue("string", `String(${value.kind})`);

const metaElement = (descriptor: StaticValue): StaticValue => {
  if (isNullish(descriptor) === true) return NULL_VALUE;
  if (descriptor.kind !== "object") {
    return unknownValue("react-router: meta descriptor is not a static object");
  }
  const keys = getKnownObjectKeys(descriptor);
  if (!keys) return unknownValue("react-router: meta descriptor has dynamic keys");
  if (keys.includes("tagName")) {
    const tagName = getObjectProperty(descriptor, "tagName");
    const rest = omitObjectKeys(descriptor, new Set(["tagName"]));
    if (rest.kind !== "object") return rest;
    if (tagName.kind !== "primitive" || typeof tagName.value !== "string") {
      return unknownValue("react-router: meta tagName is not static");
    }
    if (!META_TAG_NAMES.has(tagName.value)) return NULL_VALUE;
    return hostElement(tagName.value, rest, jsonKey(rest, false));
  }
  if (keys.includes("title")) {
    return hostElement(
      "title",
      objectFromRecord({ children: stringOf(getObjectProperty(descriptor, "title")) }),
      primitiveValue("title"),
    );
  }
  if (keys.includes("charset") || keys.includes("charSet")) {
    const charSet = keys.includes("charSet")
      ? getObjectProperty(descriptor, "charSet")
      : getObjectProperty(descriptor, "charset");
    if (charSet.kind === "primitive" && typeof charSet.value === "string") {
      return hostElement(
        "meta",
        objectFromRecord({ charSet: primitiveValue(charSet.value) }),
        primitiveValue("charSet"),
      );
    }
    return charSet.kind === "primitive"
      ? NULL_VALUE
      : unknownValue("react-router: meta charSet is not static");
  }
  if (keys.includes("script:ld+json")) {
    return hostElement(
      "script",
      objectFromRecord({
        type: primitiveValue("application/ld+json"),
        dangerouslySetInnerHTML: objectFromRecord({
          __html: unknownPrimitiveValue("string", "JSON.stringify of the ld+json payload"),
        }),
      }),
      unknownPrimitiveValue("string", "key embeds the serialized ld+json payload"),
    );
  }
  return hostElement("meta", descriptor, jsonKey(descriptor, false));
};

/** Flattens one level like `meta.flat()`, keeping unknown entries explicit. */
const flattenDescriptors = (list: StaticValue): StaticValue[] | null => {
  if (list.kind !== "list") return null;
  const flattened: StaticValue[] = [];
  for (const item of list.items) {
    if (item.kind === "list") flattened.push(...item.items);
    else if (item.kind === "repeat") return null;
    else flattened.push(item);
  }
  return flattened;
};

/** What `<Meta>` renders: an unwrapped fragment, so the head elements are direct children. */
export const renderMetaDescriptors = (meta: StaticValue): StaticValue => {
  if (meta.kind === "unknown") return meta;
  const descriptors = flattenDescriptors(meta);
  if (!descriptors) return unknownValue("react-router: meta() result is not a static array");
  return listValue(descriptors.map(metaElement));
};

const linkElement = (descriptor: StaticValue): StaticValue => {
  if (descriptor.kind !== "object") {
    return unknownValue("react-router: link descriptor is not a static object");
  }
  const crossOrigin = getObjectProperty(descriptor, "crossOrigin");
  const props = objectValue([
    { kind: "property", key: "nonce", value: UNDEFINED_VALUE },
    { kind: "spread", value: descriptor },
    { kind: "property", key: "crossOrigin", value: crossOrigin },
  ]);
  return hostElement("link", props, jsonKey(descriptor, true));
};

const mapLinkDescriptors = (links: StaticValue): StaticValue => {
  if (links.kind === "unknown") return links;
  const descriptors = flattenDescriptors(links);
  return descriptors
    ? listValue(descriptors.map(linkElement))
    : unknownValue("react-router: links() result is not a static array");
};

/**
 * What `<Links>` renders: `<>{criticalCss} {criticalCssLink} {links.map(...)}</>`.
 * The two leading nulls are why the mapped array becomes an implicit Fragment
 * fiber at runtime; keep them so the static tree has the same shape.
 */
export const renderLinkDescriptors = (links: StaticValue): StaticValue =>
  element(
    { kind: "fragment" },
    objectFromRecord({ children: listValue([NULL_VALUE, NULL_VALUE, mapLinkDescriptors(links)]) }),
  );

/**
 * Remix v2's `<Links>`: `<>{criticalCss ? <style /> : null} {links.map(...)}</>`.
 * The Vite dev server inlines the stylesheets imported by the matched modules
 * and never clears them after hydration.
 */
export const renderRemixLinkDescriptors = (
  links: StaticValue,
  hasCriticalCss: boolean,
): StaticValue => {
  const criticalStyle = hostElement(
    "style",
    objectFromRecord({
      dangerouslySetInnerHTML: objectFromRecord({
        __html: unknownPrimitiveValue("string", "remix dev critical css"),
      }),
    }),
    UNDEFINED_VALUE,
  );
  return element(
    { kind: "fragment" },
    objectFromRecord({
      children: listValue([hasCriticalCss ? criticalStyle : NULL_VALUE, mapLinkDescriptors(links)]),
    }),
  );
};

/** Concatenates each match's `links()` and drops descriptors whose (sorted) key repeats. */
export const dedupeLinkDescriptors = (perMatch: StaticValue[]): StaticValue => {
  const seen = new Set<string>();
  const kept: StaticValue[] = [];
  for (const result of perMatch) {
    const descriptors = flattenDescriptors(result);
    if (!descriptors) return unknownValue("react-router: links() result is not a static array");
    for (const descriptor of descriptors) {
      if (descriptor.kind !== "object") {
        kept.push(descriptor);
        continue;
      }
      const key = jsonKey(descriptor, true);
      if (key.kind === "primitive" && typeof key.value === "string") {
        if (seen.has(key.value)) continue;
        seen.add(key.value);
      }
      kept.push(descriptor);
    }
  }
  return listValue(kept);
};
