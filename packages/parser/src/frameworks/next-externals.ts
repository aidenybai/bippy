import { STYLED_JSX_SPECIFIER } from "../evaluate/interpreter.js";
import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  getObjectProperty,
  isKnownString,
  objectFromRecord,
  primitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import type {
  ContextDefinition,
  ExternalValueProvider,
  StaticObjectValue,
  StaticValue,
  StubComponent,
} from "../types.js";
import { ForwardRefTag } from "../work-tags.js";
import type { FrameworkKind } from "./framework-profile.js";
import {
  element,
  emptyStub,
  hostElement,
  nativeFunction,
  omitProps,
  stubElement,
  stubValue,
} from "./stubs.js";

// Static stand-ins for the `next/*` client surface (next@15). Shapes follow the
// fiber trees the real components commit: `next/link` in the App Router is
// `LinkComponent` -> LinkStatusContext provider -> <a>; in the Pages Router a
// `forwardRef` -> <a>. `next/image` is a forwardRef wrapping a forwardRef
// `ImageElement` -> <img>. Router hooks resolve from the URL being rendered;
// anything only the running router knows is an explicit unknown.

export interface NextModel {
  externalValues: ExternalValueProvider;
  /**
   * Dynamic segment values for the rendered URL. The route adapter fills this in
   * once it has matched the filesystem, so hooks like `useParams` observe the
   * same match the page was composed from.
   */
  params: Record<string, string>;
}

export type NextRouterKind = Extract<FrameworkKind, "next-app" | "next-pages">;

const LINK_ONLY_PROPS: ReadonlySet<string> = new Set([
  "href",
  "as",
  "children",
  "prefetch",
  "passHref",
  "replace",
  "shallow",
  "scroll",
  "locale",
  "onNavigate",
  "onMouseEnter",
  "onTouchStart",
  "legacyBehavior",
  "unstable_dynamicOnHover",
  "ref",
]);

const IMAGE_ONLY_PROPS: ReadonlySet<string> = new Set([
  "src",
  "priority",
  "loading",
  "quality",
  "fill",
  "placeholder",
  "blurDataURL",
  "unoptimized",
  "overrideSrc",
  "loader",
  "onLoadingComplete",
  "layout",
  "objectFit",
  "objectPosition",
  "lazyBoundary",
  "lazyRoot",
  "ref",
]);

const LINK_STATUS_CONTEXT: ContextDefinition = {
  name: "LinkStatusContext",
  displayName: null,
  defaultValue: objectFromRecord({ pending: primitiveValue(false) }),
  location: null,
};

const linkHref = (props: StaticObjectValue): StaticValue => {
  const href = getObjectProperty(props, "href");
  if (isKnownString(href)) return href;
  return unknownValue("href is formatted by the router (UrlObject or basePath)");
};

const anchorForLink = (props: StaticObjectValue): StaticValue => {
  const legacy = getObjectProperty(props, "legacyBehavior");
  if (legacy.kind === "primitive" && legacy.value === true) {
    return unknownValue("legacyBehavior clones the child element with router props");
  }
  const rest = omitProps(props, LINK_ONLY_PROPS);
  return element(
    { kind: "host", tagName: "a" },
    {
      kind: "object",
      entries: [
        ...rest.entries,
        { kind: "property", key: "href", value: linkHref(props) },
        { kind: "property", key: "children", value: getObjectProperty(props, "children") },
      ],
    },
  );
};

const APP_LINK_STUB: StubComponent = {
  displayName: "LinkComponent",
  render: (props) =>
    element(
      { kind: "context-provider", context: LINK_STATUS_CONTEXT, displayName: null },
      objectFromRecord({
        value: LINK_STATUS_CONTEXT.defaultValue,
        children: anchorForLink(props),
      }),
    ),
};

const PAGES_LINK_STUB: StubComponent = {
  displayName: "LinkComponent",
  tag: ForwardRefTag,
  render: anchorForLink,
};

const IMAGE_ELEMENT_STUB: StubComponent = {
  displayName: null,
  tag: ForwardRefTag,
  render: (props) => {
    const src = getObjectProperty(props, "src");
    const rest = omitProps(props, IMAGE_ONLY_PROPS);
    return element(
      { kind: "host", tagName: "img" },
      {
        kind: "object",
        entries: [
          ...rest.entries,
          {
            kind: "property",
            key: "src",
            value: isKnownString(src)
              ? unknownValue("src is rewritten by the image loader")
              : unknownValue("static image import"),
          },
        ],
      },
    );
  },
};

const IMAGE_STUB: StubComponent = {
  displayName: null,
  tag: ForwardRefTag,
  render: (props) => stubElement(IMAGE_ELEMENT_STUB, Object.fromEntries(propEntries(props))),
};

const propEntries = (props: StaticObjectValue): [string, StaticValue][] => {
  const entries: [string, StaticValue][] = [];
  for (const entry of props.entries) {
    if (entry.kind === "property") entries.push([entry.key, entry.value]);
  }
  return entries;
};

/** `next/head` renders its children into `<head>` through a `SideEffect` that returns null. */
const HEAD_STUB: StubComponent = {
  displayName: "Head",
  render: () => stubElement(emptyStub("SideEffect"), {}),
};

/** `next/script` renders a `<script>` only for `beforeInteractive`; every other strategy returns null. */
const SCRIPT_STUB: StubComponent = {
  displayName: "Script",
  render: (props) => {
    const strategy = getObjectProperty(props, "strategy");
    if (strategy.kind === "primitive" && strategy.value === "beforeInteractive") {
      return hostElement("script", {
        src: getObjectProperty(props, "src"),
        children: getObjectProperty(props, "children"),
      });
    }
    if (strategy.kind === "unknown") return unknownValue("script strategy decides host output");
    return NULL_VALUE;
  },
};

const routerMethods = (names: string[]): [string, StaticValue][] =>
  names.map((name) => [name, nativeFunction(name, () => UNDEFINED_VALUE)]);

const fontLoader = (name: string): StaticValue =>
  nativeFunction(name, () =>
    objectFromRecord({
      className: unknownValue("font class name is generated at build time"),
      variable: unknownValue("font CSS variable is generated at build time"),
      style: objectFromRecord({
        fontFamily: unknownValue("font family is generated at build time"),
      }),
    }),
  );

const searchParamsValue = (url: URL): StaticValue =>
  objectFromRecord({
    get: nativeFunction("get", (args) => {
      const [key] = args;
      if (!isKnownString(key)) return unknownValue("search param key is dynamic");
      const value = url.searchParams.get(String(key.value));
      return value === null ? NULL_VALUE : primitiveValue(value);
    }),
    has: nativeFunction("has", (args) => {
      const [key] = args;
      if (!isKnownString(key)) return unknownValue("search param key is dynamic");
      return primitiveValue(url.searchParams.has(String(key.value)));
    }),
    toString: nativeFunction("toString", () => primitiveValue(url.searchParams.toString())),
  });

const appNavigationValue = (
  importedName: string,
  url: URL,
  params: Record<string, string>,
): StaticValue | null => {
  switch (importedName) {
    case "useRouter":
      return nativeFunction(importedName, () =>
        objectFromRecord(
          Object.fromEntries(
            routerMethods(["push", "replace", "refresh", "back", "forward", "prefetch"]),
          ),
        ),
      );
    case "usePathname":
      return nativeFunction(importedName, () => primitiveValue(url.pathname));
    case "useSearchParams":
      return nativeFunction(importedName, () => searchParamsValue(url));
    case "useParams":
      return nativeFunction(importedName, () =>
        objectFromRecord(
          Object.fromEntries(
            Object.entries(params).map(([name, value]) => [name, primitiveValue(value)]),
          ),
        ),
      );
    case "useSelectedLayoutSegment":
    case "useSelectedLayoutSegments":
      return nativeFunction(importedName, () =>
        unknownValue(`${importedName} depends on the layout's position in the segment tree`),
      );
    case "redirect":
    case "permanentRedirect":
    case "notFound":
    case "forbidden":
    case "unauthorized":
      return nativeFunction(importedName, () =>
        unknownValue(`${importedName}() interrupts rendering with a control-flow throw`),
      );
    default:
      return null;
  }
};

const pagesRouterValue = (
  importedName: string,
  url: URL,
  params: Record<string, string>,
): StaticValue | null => {
  if (importedName !== "useRouter" && importedName !== "default") return null;
  const query = objectFromRecord({
    ...Object.fromEntries(
      Object.entries(params).map(([name, value]) => [name, primitiveValue(value)]),
    ),
    ...Object.fromEntries(
      [...url.searchParams].map(([name, value]) => [name, primitiveValue(value)]),
    ),
  });
  const router = objectFromRecord({
    pathname: unknownValue("pathname is the page's route pattern"),
    asPath: primitiveValue(`${url.pathname}${url.search}`),
    query,
    isReady: primitiveValue(true),
    isFallback: primitiveValue(false),
    isPreview: primitiveValue(false),
    locale: UNDEFINED_VALUE,
    ...Object.fromEntries(
      routerMethods(["push", "replace", "reload", "back", "prefetch", "beforePopState"]),
    ),
  });
  return importedName === "useRouter" ? nativeFunction(importedName, () => router) : router;
};

export interface NextModelOptions {
  kind: NextRouterKind;
  /** The URL being rendered (pathname plus search). */
  route: string;
}

export const createNextModel = (options: NextModelOptions): NextModel => {
  const url = new URL(options.route, "http://static.invalid");
  const params: Record<string, string> = {};
  const externalValues: ExternalValueProvider = (packageName, importedName) => {
    switch (packageName) {
      case "next/link":
        return importedName === "default"
          ? stubValue(options.kind === "next-app" ? APP_LINK_STUB : PAGES_LINK_STUB)
          : null;
      case "next/image":
      case "next/legacy/image":
        return importedName === "default" ? stubValue(IMAGE_STUB) : null;
      case "next/head":
        return importedName === "default" ? stubValue(HEAD_STUB) : null;
      case "next/script":
        return importedName === "default" ? stubValue(SCRIPT_STUB) : null;
      case "next/dynamic":
        return importedName === "default"
          ? nativeFunction("dynamic", () =>
              unknownValue("next/dynamic loads its component asynchronously"),
            )
          : null;
      case "next/font/google":
      case "next/font/local":
        return fontLoader(importedName);
      case "next/navigation":
        return appNavigationValue(importedName, url, params);
      case "next/router":
        return pagesRouterValue(importedName, url, params);
      case STYLED_JSX_SPECIFIER:
        return importedName === "default" ? stubValue(emptyStub("JSXStyle")) : null;
      default:
        return null;
    }
  };
  return { externalValues, params };
};
