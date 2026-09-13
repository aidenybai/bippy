import {
  NULL_VALUE,
  branchValue,
  getObjectProperty,
  getTruthiness,
  isKnownString,
  listValue,
  objectFromRecord,
  primitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import type {
  StaticObjectValue,
  StaticPrimitiveValue,
  StaticValue,
  StubComponent,
} from "../types.js";
import { element, hostElement, omitProps, stubElement } from "../evaluate/stubs.js";

import { isVersionAtLeast } from "../libraries/installed-version.js";

interface LegacyImageShape {
  version: string | null;
  head: StubComponent;
}

const LEGACY_IMAGE_ONLY_PROPS: ReadonlySet<string> = new Set([
  "src",
  "sizes",
  "unoptimized",
  "priority",
  "loading",
  "lazyRoot",
  "lazyBoundary",
  "className",
  "quality",
  "width",
  "height",
  "style",
  "objectFit",
  "objectPosition",
  "onLoadingComplete",
  "placeholder",
  "blurDataURL",
  "layout",
  "loader",
]);

const knownPrimitive = (props: StaticObjectValue, key: string): StaticPrimitiveValue | null => {
  const value = getObjectProperty(props, key);
  return value.kind === "primitive" ? value : null;
};

const legacyImageLayout = (props: StaticObjectValue): string | null => {
  const layout = knownPrimitive(props, "layout");
  if (layout === null) return null;
  if (isKnownString(layout)) return layout.value;
  const sizes = knownPrimitive(props, "sizes");
  if (sizes === null) return null;
  return sizes.value === undefined ? "intrinsic" : "responsive";
};

const isLegacyImageLazy = (props: StaticObjectValue, supportsBlob = true): boolean | null => {
  const isPriority = getTruthiness(getObjectProperty(props, "priority"));
  if (isPriority === null) return null;
  if (isPriority) return false;
  const loading = knownPrimitive(props, "loading");
  if (loading === null) return null;
  if (loading.value !== undefined && loading.value !== "lazy") return false;
  const src = getObjectProperty(props, "src");
  if (!isKnownString(src)) return null;
  return !src.value.startsWith("data:") && (!supportsBlob || !src.value.startsWith("blob:"));
};

const legacyImageSizer = (
  props: StaticObjectValue,
  layout: string,
  wrapperTag: string,
): StaticValue => {
  const hasDimensions =
    knownPrimitive(props, "width")?.value !== undefined &&
    knownPrimitive(props, "height")?.value !== undefined;
  if (!hasDimensions || (layout !== "responsive" && layout !== "intrinsic")) return NULL_VALUE;
  return hostElement(wrapperTag, {
    children: layout === "intrinsic" ? hostElement("img", { alt: primitiveValue("") }) : NULL_VALUE,
  });
};

const legacyImageHost = (props: StaticObjectValue): StaticValue =>
  element(
    { kind: "host", tagName: "img" },
    {
      kind: "object",
      entries: [
        ...omitProps(props, LEGACY_IMAGE_ONLY_PROPS).entries,
        {
          kind: "property",
          key: "src",
          value: unknownValue("src is rewritten by the image loader"),
        },
      ],
    },
  );

const legacyImageNoscript = (props: StaticObjectValue, isNoscript: boolean | null): StaticValue =>
  isNoscript === null
    ? unknownValue("lazy loading depends on the priority/loading/src props")
    : isNoscript
      ? hostElement("noscript", { children: legacyImageHost(props) })
      : primitiveValue(false);

const legacyImagePreload = (props: StaticObjectValue, head: StubComponent): StaticValue => {
  const isPriority = getTruthiness(getObjectProperty(props, "priority"));
  if (isPriority === null) return unknownValue("priority decides the preload <Head>");
  return isPriority
    ? stubElement(head, { children: hostElement("link", { rel: primitiveValue("preload") }) })
    : NULL_VALUE;
};

const LEGACY_IMAGE_ELEMENT_STUB: StubComponent = {
  displayName: "ImageElement",
  render: (props) => {
    const isLazy = isLegacyImageLazy(props);
    const placeholder = knownPrimitive(props, "placeholder");
    const isNoscript =
      isLazy === true || placeholder?.value === "blur"
        ? true
        : isLazy === null || placeholder === null
          ? null
          : false;
    return listValue([legacyImageHost(props), legacyImageNoscript(props, isNoscript)]);
  },
};

export const legacyImageStub = ({ version, head }: LegacyImageShape): StubComponent => {
  const isAtLeast = (minimum: string): boolean =>
    version === null || isVersionAtLeast(version, minimum);
  const hasImageElement = isAtLeast("12.1.1");
  const wrapperTag = isAtLeast("12.0.0") ? "span" : "div";
  const hasVisibilityFallback = !isAtLeast("11.1.1");
  const getFallback = (props: StaticObjectValue): StaticValue => {
    if (!isAtLeast("10.1.0")) return NULL_VALUE;
    if (!hasVisibilityFallback && !isAtLeast("12.0.8")) return legacyImageNoscript(props, true);
    const isLazy = isLegacyImageLazy(props, !hasVisibilityFallback);
    return hasVisibilityFallback && isLazy === true
      ? branchValue(
          [primitiveValue(false), legacyImageNoscript(props, true)],
          "whether a lazy image has become visible",
        )
      : legacyImageNoscript(props, isLazy);
  };
  return {
    displayName: "Image",
    render: (props) => {
      if (!isAtLeast("10.0.0")) return unknownValue("next/image is unavailable before Next 10");
      if (!isAtLeast("10.0.1")) {
        return hostElement("div", {
          children: hostElement("div", { children: legacyImageHost(props) }),
        });
      }
      const layout = legacyImageLayout(props);
      if (layout === null) return unknownValue("layout depends on the layout/sizes props");
      const sizer = legacyImageSizer(props, layout, wrapperTag);
      const preload = isAtLeast("10.0.5") ? legacyImagePreload(props, head) : NULL_VALUE;
      if (hasImageElement) {
        const wrapper = hostElement(wrapperTag, {
          children: listValue([
            sizer,
            element({ kind: "stub", stub: LEGACY_IMAGE_ELEMENT_STUB }, props),
          ]),
        });
        return element(
          { kind: "fragment" },
          objectFromRecord({ children: listValue([wrapper, preload]) }),
        );
      }
      const fallback = getFallback(props);
      const image = legacyImageHost(props);
      return hostElement(wrapperTag, {
        children: listValue([
          sizer,
          ...(hasVisibilityFallback ? [fallback, image] : [image, fallback]),
          preload,
        ]),
      });
    },
  };
};
