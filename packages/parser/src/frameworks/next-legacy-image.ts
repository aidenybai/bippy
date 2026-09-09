import {
  NULL_VALUE,
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

// The pre-13 `next/image` (client/image.js in next@12, client/legacy/image.js
// since 13): a wrapper `<span>` sized by `layout`, an optional sizer `<span>`,
// the `<img>`, a `<noscript>` fallback for lazy images, and a preload `<Head>`
// for `priority`. 12.2 moved the `<img>`/`<noscript>` pair into an
// `ImageElement` component and wrapped everything in a Fragment.

interface LegacyImageShape {
  hasImageElement: boolean;
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

const isLegacyImageLazy = (props: StaticObjectValue): boolean | null => {
  const isPriority = getTruthiness(getObjectProperty(props, "priority"));
  if (isPriority === null) return null;
  if (isPriority) return false;
  const loading = knownPrimitive(props, "loading");
  if (loading === null) return null;
  if (loading.value !== undefined && loading.value !== "lazy") return false;
  const src = getObjectProperty(props, "src");
  if (!isKnownString(src)) return null;
  return !src.value.startsWith("data:") && !src.value.startsWith("blob:");
};

const legacyImageSizer = (props: StaticObjectValue, layout: string): StaticValue => {
  const hasDimensions =
    knownPrimitive(props, "width")?.value !== undefined &&
    knownPrimitive(props, "height")?.value !== undefined;
  if (!hasDimensions || (layout !== "responsive" && layout !== "intrinsic")) return NULL_VALUE;
  return hostElement("span", {
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

export const legacyImageStub = (shape: LegacyImageShape): StubComponent => ({
  displayName: "Image",
  render: (props) => {
    const layout = legacyImageLayout(props);
    if (layout === null) return unknownValue("layout depends on the layout/sizes props");
    const sizer = legacyImageSizer(props, layout);
    const preload = legacyImagePreload(props, shape.head);
    if (shape.hasImageElement) {
      const wrapper = hostElement("span", {
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
    return hostElement("span", {
      children: listValue([
        sizer,
        legacyImageHost(props),
        legacyImageNoscript(props, isLegacyImageLazy(props)),
        preload,
      ]),
    });
  },
});
