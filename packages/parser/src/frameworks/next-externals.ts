import { STYLED_JSX_SPECIFIER } from "../evaluate/interpreter.js";
import { createSearchParamsValue } from "../evaluate/url-search-params.js";
import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  getObjectProperty,
  getTruthiness,
  mapValue,
  isKnownString,
  listValue,
  objectFromRecord,
  primitiveValue,
  thrownValue,
  unknownValue,
} from "../evaluate/values.js";
import type {
  CapturedRequest,
  ContextDefinition,
  ExternalValueProvider,
  StaticElementType,
  StaticObjectValue,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";
import { ForwardRefTag } from "../work-tags.js";
import type { FrameworkKind } from "./framework-profile.js";
import { toElementType } from "../react/element-type.js";
import { createNextIntlModel, type NextIntlModel } from "../libraries/next-intl.js";
import { nextRequestValue } from "./next-request.js";
import {
  element,
  emptyStub,
  hostElement,
  nativeFunction,
  omitProps,
  passthroughStub,
  stubElement,
  stubValue,
} from "./stubs.js";

// Static stand-ins for the `next/*` client surface (next@15). Shapes follow the
// fiber trees the real components commit: `next/link` in the App Router is
// `LinkComponent` -> LinkStatusContext provider -> <a>; in the Pages Router a
// `forwardRef` -> <a>. `next/image` is a forwardRef wrapping a forwardRef
// `ImageElement` -> <img>, followed by `ImagePreload` when `priority`/`preload`
// is set. Router hooks resolve from the URL being rendered; anything only the
// running router knows is an explicit unknown.

export interface NextModel {
  externalValues: ExternalValueProvider;
  /**
   * Dynamic segment values for the rendered URL. The route adapter fills this in
   * once it has matched the filesystem, so hooks like `useParams` observe the
   * same match the page was composed from.
   */
  params: Record<string, string>;
  /** `next-intl`, whose request configuration `next.config` registers through its plugin. */
  intl: NextIntlModel;
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

/** `next/head` renders its children into `<head>` through a `SideEffect` that returns null. */
const HEAD_STUB: StubComponent = {
  displayName: "Head",
  render: () => stubElement(emptyStub("SideEffect"), {}),
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

/**
 * `ImagePreload` (next/dist/client/image-component.js) for a `preload` or
 * `priority` image: `ReactDOM.preload` and null in the App Router, a
 * `next/head` `<link rel="preload">` in the Pages Router.
 */
const imagePreloadStub = (kind: NextRouterKind): StubComponent => ({
  displayName: "ImagePreload",
  render: (props) =>
    kind === "next-app"
      ? NULL_VALUE
      : stubElement(HEAD_STUB, {
          children: hostElement("link", {
            rel: primitiveValue("preload"),
            href: getObjectProperty(props, "src"),
            as: primitiveValue("image"),
          }),
        }),
});

const imageStub = (kind: NextRouterKind): StubComponent => {
  const preloadStub = imagePreloadStub(kind);
  return {
    displayName: null,
    tag: ForwardRefTag,
    render: (props) => {
      const imageProps = Object.fromEntries(propEntries(props));
      const isPreload = getTruthiness(getObjectProperty(props, "preload"));
      const isPriority = getTruthiness(getObjectProperty(props, "priority"));
      const preloadElement = stubElement(preloadStub, { src: getObjectProperty(props, "src") });
      const preload =
        isPreload === true || isPriority === true
          ? preloadElement
          : isPreload === false && isPriority === false
            ? NULL_VALUE
            : branchValue(
                [NULL_VALUE, preloadElement],
                "priority decides whether the image preloads",
              );
      return element(
        { kind: "fragment" },
        objectFromRecord({
          children: listValue([stubElement(IMAGE_ELEMENT_STUB, imageProps), preload]),
        }),
      );
    },
  };
};

const propEntries = (props: StaticObjectValue): [string, StaticValue][] => {
  const entries: [string, StaticValue][] = [];
  for (const entry of props.entries) {
    if (entry.kind === "property") entries.push([entry.key, entry.value]);
  }
  return entries;
};

/**
 * `next/script` commits a `<script>` only for `beforeInteractive` in the App
 * Router; the Pages Router hands every strategy to the head manager and
 * renders nothing.
 */
const scriptStub = (kind: NextRouterKind): StubComponent => ({
  displayName: "Script",
  render: (props) => {
    if (kind === "next-pages") return NULL_VALUE;
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
});

const BAILOUT_TO_CSR_STUB = passthroughStub("BailoutToCSR");

const PRELOAD_CHUNKS_STUB = emptyStub("PreloadChunks");

/**
 * `next/dynamic` at the time the page is captured: the chunk has loaded, so the
 * App Router's `LoadableComponent` (a server component unless client code
 * rendered it) commits Fragment/Suspense -> `<Lazy>`, preceded by the client
 * `PreloadChunks` only when it ran on the server, and the Pages Router's
 * forwardRef `LoadableComponent` renders the loaded module's default export
 * directly.
 */
const dynamicComponent = (
  kind: NextRouterKind,
  [first, second]: StaticValue[],
  tools: StubRenderTools,
): StaticValue => {
  const options = [first, second].filter((option) => option?.kind === "object");
  const readOption = (name: string): StaticValue =>
    options.reduce<StaticValue>((current, option) => {
      const value = getObjectProperty(option, name);
      return value.kind === "primitive" && value.value === undefined ? current : value;
    }, UNDEFINED_VALUE);
  const loader = first === undefined || first.kind === "object" ? readOption("loader") : first;
  return mapValue(loader, (alternative) => loadableComponent(kind, alternative, readOption, tools));
};

const loadableComponent = (
  kind: NextRouterKind,
  loader: StaticValue,
  readOption: (name: string) => StaticValue,
  tools: StubRenderTools,
): StaticValue => {
  const lazy = tools.call({ kind: "react-api", api: "lazy" }, [loader]);
  if (lazy.kind !== "component-reference" || lazy.type.kind !== "lazy") {
    return unknownValue("next/dynamic loader is not a statically known module");
  }
  const lazyType: StaticElementType = lazy.type;
  if (kind === "next-pages") {
    return stubValue({
      displayName: "LoadableComponent",
      tag: ForwardRefTag,
      render: (props) =>
        lazyType.inner
          ? element(lazyType.inner, props)
          : unknownValue("next/dynamic loader did not resolve to a component"),
    });
  }
  const ssrOption = readOption("ssr");
  const isSsr =
    ssrOption.kind === "primitive" && ssrOption.value === undefined
      ? true
      : getTruthiness(ssrOption);
  const loading = readOption("loading");
  const hasLoading = getTruthiness(loading);
  if (isSsr === null || hasLoading === null) {
    return unknownValue("next/dynamic options decide its suspense boundary");
  }
  const loadableGenerated = readOption("loadableGenerated");
  const moduleIds =
    loadableGenerated.kind === "object"
      ? getObjectProperty(loadableGenerated, "modules")
      : UNDEFINED_VALUE;
  return stubValue({
    displayName: "LoadableComponent",
    isServerComponent: true,
    render: (props, renderTools) => {
      const lazyElement = element(lazyType, props);
      const preloadChunks =
        renderTools.environment === "server"
          ? stubElement(PRELOAD_CHUNKS_STUB, { moduleIds })
          : NULL_VALUE;
      const children = isSsr
        ? element(
            { kind: "fragment" },
            objectFromRecord({ children: listValue([preloadChunks, lazyElement]) }),
          )
        : stubElement(BAILOUT_TO_CSR_STUB, {
            reason: primitiveValue("next/dynamic"),
            children: lazyElement,
          });
      if (!isSsr || hasLoading) {
        const fallback = hasLoading
          ? element(
              toElementType(loading, null),
              objectFromRecord({
                isLoading: primitiveValue(true),
                pastDelay: primitiveValue(true),
                error: NULL_VALUE,
              }),
            )
          : NULL_VALUE;
        return element({ kind: "suspense" }, objectFromRecord({ fallback, children }));
      }
      return element({ kind: "fragment" }, objectFromRecord({ children }));
    },
  });
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
      return nativeFunction(importedName, () =>
        createSearchParamsValue(primitiveValue(url.search), { isReadonly: true }),
      );
    case "ReadonlyURLSearchParams":
      return nativeFunction(importedName, ([initial]) =>
        createSearchParamsValue(initial, { isReadonly: true }),
      );
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
        thrownValue(
          `${importedName}() interrupts rendering with a control-flow throw`,
          unknownValue(`${importedName}() error`),
        ),
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
  /** Origin the dev server serves from; `http://static.invalid` when unknown. */
  origin?: string;
  /** The document request the server rendered, when captured. */
  request?: CapturedRequest;
}

export const createNextModel = (options: NextModelOptions): NextModel => {
  const url = new URL(options.route, options.origin ?? "http://static.invalid");
  const params: Record<string, string> = {};
  const linkStub = options.kind === "next-app" ? APP_LINK_STUB : PAGES_LINK_STUB;
  const image = imageStub(options.kind);
  const intl = createNextIntlModel({
    link: linkStub,
    navigation: (importedName) => appNavigationValue(importedName, url, params),
  });
  const externalValues: ExternalValueProvider = (packageName, importedName) => {
    switch (packageName) {
      case "next/link":
        return importedName === "default" ? stubValue(linkStub) : null;
      case "next/image":
      case "next/legacy/image":
        return importedName === "default" ? stubValue(image) : null;
      case "next/head":
        return importedName === "default" ? stubValue(HEAD_STUB) : null;
      case "next/script":
        return importedName === "default" ? stubValue(scriptStub(options.kind)) : null;
      case "next/dynamic":
        return importedName === "default"
          ? nativeFunction("dynamic", (args, tools) => dynamicComponent(options.kind, args, tools))
          : null;
      case "next/font/google":
      case "next/font/local":
        return fontLoader(importedName);
      case "next/navigation":
        return appNavigationValue(importedName, url, params);
      case "next/headers":
        return nextRequestValue(importedName, options.request ?? null, options.origin ?? null);
      case "next/router":
        return pagesRouterValue(importedName, url, params);
      case STYLED_JSX_SPECIFIER:
        return importedName === "default" ? stubValue(emptyStub("JSXStyle")) : null;
      default:
        return intl.externalValues(packageName, importedName);
    }
  };
  return { externalValues, params, intl };
};
