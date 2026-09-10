import { isVersionAtLeast } from "../libraries/installed-version.js";
import { STYLED_JSX_SPECIFIER } from "../evaluate/interpreter.js";
import { createSearchParamsValue } from "../evaluate/url-search-params.js";
import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  describeValue,
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
import { ClassComponentTag, ForwardRefTag } from "../work-tags.js";
import type { FrameworkKind } from "./framework-profile.js";
import { toElementType } from "../react/element-type.js";
import { legacyImageStub } from "./next-legacy-image.js";
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
} from "../evaluate/stubs.js";

// Static stand-ins for the `next/*` client surface. Shapes follow the fiber
// trees the real components commit: `next/link` in the App Router (15.3+) is
// `LinkComponent` -> LinkStatusContext provider -> <a>; before 15.3 and in the
// Pages Router a `forwardRef` -> <a>. `next/image` is a forwardRef wrapping a forwardRef
// `ImageElement` -> <img>, followed by `ImagePreload` when `priority`/`preload`
// is set. Router hooks resolve from the URL being rendered; anything only the
// running router knows is an explicit unknown.

/** The build phases `next/constants` exports (`next/dist/shared/lib/constants`). */
export const NEXT_PHASES: Record<string, string> = {
  PHASE_EXPORT: "phase-export",
  PHASE_PRODUCTION_BUILD: "phase-production-build",
  PHASE_PRODUCTION_SERVER: "phase-production-server",
  PHASE_DEVELOPMENT_SERVER: "phase-development-server",
  PHASE_TEST: "phase-test",
  PHASE_INFO: "phase-info",
};

export interface NextModel {
  externalValues: ExternalValueProvider;
  /**
   * Dynamic segment values for the rendered URL. The route adapter fills this in
   * once it has matched the filesystem, so hooks like `useParams` observe the
   * same match the page was composed from.
   */
  params: Record<string, string>;
  /** The matched page file's route, which the pages router reports as `pathname`; filled in with `params`. */
  page: NextPageRoute;
  /** `next-intl`, whose request configuration `next.config` registers through its plugin. */
  intl: NextIntlModel;
}

export interface NextPageRoute {
  /** `/posts/[slug]` for `pages/posts/[slug].tsx`; `null` until a page matched. */
  pathname: string | null;
}

type NextRouterKind = Extract<FrameworkKind, "next-app" | "next-pages">;

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

const FORM_ONLY_PROPS: ReadonlySet<string> = new Set(["replace", "scroll", "prefetch", "ref"]);
const CHILDREN_PROP: ReadonlySet<string> = new Set(["children"]);

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

/** `legacyBehavior` wraps string children in `<a>` and otherwise clones the child element (adding `href` to a bare `<a>` or with `passHref`). */
const legacyLinkChild = (props: StaticObjectValue): StaticValue => {
  const children = getObjectProperty(props, "children");
  if (
    children.kind === "primitive" &&
    (typeof children.value === "string" || typeof children.value === "number")
  ) {
    return hostElement("a", { href: linkHref(props), children });
  }
  if (children.kind !== "element") {
    return unknownValue(`legacyBehavior clones ${describeValue(children)} with router props`);
  }
  const childHref = getObjectProperty(children.props, "href");
  const isBareAnchor =
    children.type.kind === "host" &&
    children.type.tagName === "a" &&
    childHref.kind === "primitive" &&
    childHref.value === undefined;
  const passHref = getTruthiness(getObjectProperty(props, "passHref"));
  if (!isBareAnchor && passHref !== true) return children;
  return {
    ...children,
    props: {
      kind: "object",
      entries: [
        ...children.props.entries,
        { kind: "property", key: "href", value: linkHref(props) },
      ],
    },
  };
};

const isLegacyLinkBehavior = (
  props: StaticObjectValue,
  options: NextModelOptions,
): boolean | null => {
  const legacy = getObjectProperty(props, "legacyBehavior");
  if (legacy.kind === "primitive" && legacy.value === undefined) {
    return options.version !== null && !isVersionAtLeast(options.version, "13.0.0");
  }
  return getTruthiness(legacy);
};

const anchorForLink = (props: StaticObjectValue, options: NextModelOptions): StaticValue => {
  const isLegacy = isLegacyLinkBehavior(props, options);
  if (isLegacy === true) return legacyLinkChild(props);
  if (isLegacy === null) {
    return unknownValue("legacyBehavior decides whether Link renders an <a>");
  }
  const rest = omitProps(props, LINK_ONLY_PROPS);
  return element(
    { kind: "host", tagName: "a" },
    {
      kind: "object",
      entries: [
        ...rest.entries,
        { kind: "property", key: "href", value: linkHref(props) },
        {
          kind: "property",
          key: "children",
          value: getObjectProperty(props, "children"),
        },
      ],
    },
  );
};

/** `app-dir/link` became a plain function publishing `LinkStatusContext` in Next 15.3; before that it was the pages `forwardRef`. */
const hasLinkStatus = (options: NextModelOptions): boolean =>
  options.kind === "next-app" &&
  (options.version === null || isVersionAtLeast(options.version, "15.3.0"));

/** Before Next 12.2 `next/link` was a plain `Link` function; since then a `forwardRef` named `LinkComponent`. */
const createLinkStub = (options: NextModelOptions): StubComponent => {
  const render = (props: StaticObjectValue): StaticValue => anchorForLink(props, options);
  if (hasLinkStatus(options)) {
    return {
      displayName: "LinkComponent",
      isRenderNamed: true,
      render: (props) =>
        element(
          {
            kind: "context-provider",
            context: LINK_STATUS_CONTEXT,
            displayName: null,
          },
          objectFromRecord({
            value: LINK_STATUS_CONTEXT.defaultValue,
            children: render(props),
          }),
        ),
    };
  }
  if (options.version !== null && !isVersionAtLeast(options.version, "12.2.0")) {
    return { displayName: "Link", isRenderNamed: true, render };
  }
  return { displayName: "LinkComponent", tag: ForwardRefTag, isRenderNamed: true, render };
};

/**
 * `next/head` renders its children into `<head>` through a `SideEffect` that
 * returns null; before Next 12.2 it was an anonymous class React names `_class`
 * (`class _default` in the CommonJS output before 11.1).
 */
const HEAD_STUB: StubComponent = {
  displayName: "Head",
  isRenderNamed: true,
  render: () => stubElement(emptyStub("SideEffect"), {}),
};

const classHeadStub = (className: string): StubComponent => ({
  displayName: "Head",
  render: () =>
    stubElement({ displayName: className, tag: ClassComponentTag, render: () => NULL_VALUE }, {}),
});

const createHeadStub = ({ version }: NextModelOptions): StubComponent =>
  version === null || isVersionAtLeast(version, "12.2.0")
    ? HEAD_STUB
    : classHeadStub(isVersionAtLeast(version, "11.1.0") ? "_class" : "_default");

/**
 * `next/document` (next/dist/pages/_document.js) as the server renders it:
 * `<Head>` starts with `defaultHead()`'s metas, `<Main>` is the
 * `next-js-internal-body-render-target` the renderer replaces with the
 * `<div id="__next">` the page mounts into, and `<NextScript>`'s scripts are not
 * DOM the page's code sees rendered.
 */
const DOCUMENT_HTML_STUB: StubComponent = {
  displayName: "Html",
  render: (props) => element({ kind: "host", tagName: "html" }, props),
};

const DOCUMENT_HEAD_STUB: StubComponent = {
  displayName: "Head",
  render: (props) =>
    element(
      { kind: "host", tagName: "head" },
      {
        kind: "object",
        entries: [
          ...omitProps(props, CHILDREN_PROP).entries,
          {
            kind: "property",
            key: "children",
            value: listValue([
              hostElement("meta", { charSet: primitiveValue("utf-8") }),
              hostElement("meta", {
                name: primitiveValue("viewport"),
                content: primitiveValue("width=device-width"),
              }),
              getObjectProperty(props, "children"),
            ]),
          },
        ],
      },
    ),
};

const DOCUMENT_MAIN_STUB: StubComponent = {
  displayName: "Main",
  render: () => hostElement("div", { id: primitiveValue("__next") }),
};

const NEXT_SCRIPT_STUB = emptyStub("NextScript");

export const DEFAULT_DOCUMENT_STUB: StubComponent = {
  displayName: "Document",
  tag: ClassComponentTag,
  render: () =>
    stubElement(DOCUMENT_HTML_STUB, {
      children: listValue([
        stubElement(DOCUMENT_HEAD_STUB, {}),
        hostElement("body", {
          children: listValue([
            stubElement(DOCUMENT_MAIN_STUB, {}),
            stubElement(NEXT_SCRIPT_STUB, {}),
          ]),
        }),
      ]),
    }),
};

const documentValue = (importedName: string): StaticValue | null => {
  switch (importedName) {
    case "default":
      return stubValue(DEFAULT_DOCUMENT_STUB);
    case "Html":
      return stubValue(DOCUMENT_HTML_STUB);
    case "Head":
      return stubValue(DOCUMENT_HEAD_STUB);
    case "Main":
      return stubValue(DOCUMENT_MAIN_STUB);
    case "NextScript":
      return stubValue(NEXT_SCRIPT_STUB);
    default:
      return null;
  }
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

const headPreloadLink = (head: StubComponent, src: StaticValue): StaticValue =>
  stubElement(head, {
    children: hostElement("link", {
      rel: primitiveValue("preload"),
      href: src,
      as: primitiveValue("image"),
    }),
  });

/**
 * `ImagePreload` (next/dist/client/image-component.js) for a `preload` or
 * `priority` image: `ReactDOM.preload` and null in the App Router, a
 * `next/head` `<link rel="preload">` in the Pages Router.
 */
const imagePreloadStub = (kind: NextRouterKind, head: StubComponent): StubComponent => ({
  displayName: "ImagePreload",
  render: (props) =>
    kind === "next-app" ? NULL_VALUE : headPreloadLink(head, getObjectProperty(props, "src")),
});

interface ImageStubOptions {
  kind: NextRouterKind;
  head: StubComponent;
  /** Before 13.4.11 a `priority` image rendered the `next/head` preload link inline in both routers. */
  hasImagePreload: boolean;
}

const imageStub = ({ kind, head, hasImagePreload }: ImageStubOptions): StubComponent => {
  const preloadStub = imagePreloadStub(kind, head);
  return {
    displayName: null,
    tag: ForwardRefTag,
    render: (props) => {
      const imageProps = Object.fromEntries(propEntries(props));
      const src = getObjectProperty(props, "src");
      const isPreload = hasImagePreload
        ? getTruthiness(getObjectProperty(props, "preload"))
        : false;
      const isPriority = getTruthiness(getObjectProperty(props, "priority"));
      const preloadElement = hasImagePreload
        ? stubElement(preloadStub, { src })
        : headPreloadLink(head, src);
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

interface NextImageStubs {
  image: StaticValue;
  legacyImage: StaticValue;
}

/** `next/image` before 13.0 is today's `next/legacy/image`; the inner `ImageElement` component arrived in 12.1.1. */
const imageStubs = (options: NextModelOptions, head: StubComponent): NextImageStubs => {
  const hasImageElement = options.version === null || isVersionAtLeast(options.version, "12.1.1");
  const legacyImage = stubValue(legacyImageStub({ hasImageElement, head }));
  return {
    image:
      options.version !== null && !isVersionAtLeast(options.version, "13.0.0")
        ? legacyImage
        : stubValue(
            imageStub({
              kind: options.kind,
              head,
              hasImagePreload:
                options.version === null || isVersionAtLeast(options.version, "13.4.11"),
            }),
          ),
    legacyImage,
  };
};

const formElement = (props: StaticObjectValue): StaticValue =>
  element({ kind: "host", tagName: "form" }, omitProps(props, FORM_ONLY_PROPS));

/** `next/form` is a plain `Form` -> <form> in the App Router and a forwardRef `FormComponent` -> <form> in the Pages Router. */
const APP_FORM_STUB: StubComponent = {
  displayName: "Form",
  isRenderNamed: true,
  render: formElement,
};

const FORWARD_REF_FORM_STUB: StubComponent = {
  displayName: "FormComponent",
  tag: ForwardRefTag,
  isRenderNamed: true,
  render: formElement,
};

/**
 * `next/script` commits a `<script>` only for `beforeInteractive` in the App
 * Router; the Pages Router hands every strategy to the head manager and
 * renders nothing.
 */
const scriptStub = (kind: NextRouterKind): StubComponent => ({
  displayName: "Script",
  isRenderNamed: true,
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

const NO_SSR_STUB = passthroughStub("NoSSR");

const PRELOAD_CHUNKS_STUB = emptyStub("PreloadChunks");

/** The App Router `LoadableComponent`: `NoSSR` became `BailoutToCSR` in 14.1; 15.0 made the Suspense boundary conditional and added `PreloadChunks`. */
interface AppLoadableShape {
  clientOnlyWrapper: StubComponent;
  isSuspenseConditional: boolean;
}

const appLoadableShape = (options: NextModelOptions): AppLoadableShape => ({
  clientOnlyWrapper:
    options.version === null || isVersionAtLeast(options.version, "14.1.0")
      ? BAILOUT_TO_CSR_STUB
      : NO_SSR_STUB,
  isSuspenseConditional: options.version === null || isVersionAtLeast(options.version, "15.0.0"),
});

/**
 * `next/dynamic` at the time the page is captured: the chunk has loaded, so the
 * App Router's `LoadableComponent` (a server component unless client code
 * rendered it) commits Fragment/Suspense -> `<Lazy>`, preceded by the client
 * `PreloadChunks` only when it ran on the server, and the Pages Router's
 * forwardRef `LoadableComponent` renders the loaded module's default export
 * directly.
 */
const dynamicComponent = (
  options: NextModelOptions,
  [first, second]: StaticValue[],
  tools: StubRenderTools,
): StaticValue => {
  const dynamicOptions = [first, second].filter((option) => option?.kind === "object");
  const readOption = (name: string): StaticValue =>
    dynamicOptions.reduce<StaticValue>((current, option) => {
      const value = getObjectProperty(option, name);
      return value.kind === "primitive" && value.value === undefined ? current : value;
    }, UNDEFINED_VALUE);
  const loader = first === undefined || first.kind === "object" ? readOption("loader") : first;
  return mapValue(loader, (alternative) =>
    loadableComponent(options, alternative, readOption, tools),
  );
};

const loadableComponent = (
  options: NextModelOptions,
  loader: StaticValue,
  readOption: (name: string) => StaticValue,
  tools: StubRenderTools,
): StaticValue => {
  const lazy = tools.call({ kind: "react-api", api: "lazy" }, [loader]);
  if (lazy.kind !== "component-reference" || lazy.type.kind !== "lazy") {
    return unknownValue("next/dynamic loader is not a statically known module");
  }
  const lazyType: StaticElementType = lazy.type;
  if (options.kind === "next-pages") {
    return stubValue({
      displayName: "LoadableComponent",
      tag: ForwardRefTag,
      isRenderNamed: true,
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
  const { clientOnlyWrapper, isSuspenseConditional } = appLoadableShape(options);
  return stubValue({
    displayName: "LoadableComponent",
    isServerComponent: true,
    render: (props, renderTools) => {
      const lazyElement = element(lazyType, props);
      const preloadChunks =
        isSuspenseConditional && renderTools.environment === "server"
          ? stubElement(PRELOAD_CHUNKS_STUB, { moduleIds })
          : NULL_VALUE;
      const children = isSsr
        ? element(
            { kind: "fragment" },
            objectFromRecord({ children: listValue([preloadChunks, lazyElement]) }),
          )
        : stubElement(clientOnlyWrapper, {
            reason: primitiveValue("next/dynamic"),
            children: lazyElement,
          });
      if (!isSuspenseConditional || !isSsr || hasLoading) {
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
        createSearchParamsValue(primitiveValue(url.search), {
          isReadonly: true,
        }),
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
  page: NextPageRoute,
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
    pathname:
      page.pathname === null
        ? unknownValue("pathname is the page's route pattern")
        : primitiveValue(page.pathname),
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

interface NextModelOptions {
  kind: NextRouterKind;
  /** The URL being rendered (pathname plus search). */
  route: string;
  /** Origin the dev server serves from; `http://static.invalid` when unknown. */
  origin?: string;
  /** The document request the server rendered, when captured. */
  request?: CapturedRequest;
  /** Installed `next` version; `null` models the latest release. */
  version: string | null;
  /** Installed `next-intl` release; `null` when it cannot be read or is not installed. */
  nextIntlVersion: string | null;
}

export const createNextModel = (options: NextModelOptions): NextModel => {
  const url = new URL(options.route, options.origin ?? "http://static.invalid");
  const params: Record<string, string> = {};
  const page: NextPageRoute = { pathname: null };
  const linkStub = createLinkStub(options);
  const intl = createNextIntlModel({
    link: linkStub,
    navigation: (importedName) => appNavigationValue(importedName, url, params),
    version: options.nextIntlVersion,
  });
  const head = createHeadStub(options);
  const images = imageStubs(options, head);
  const externalValues: ExternalValueProvider = (packageName, importedName) => {
    switch (packageName) {
      case "next/link":
        if (importedName === "useLinkStatus") {
          return nativeFunction(importedName, (_args, tools) =>
            tools.readContext(LINK_STATUS_CONTEXT),
          );
        }
        return importedName === "default" ? stubValue(linkStub) : null;
      case "next/form":
        return importedName === "default"
          ? stubValue(options.kind === "next-app" ? APP_FORM_STUB : FORWARD_REF_FORM_STUB)
          : null;
      case "next/image":
        return importedName === "default" ? images.image : null;
      case "next/legacy/image":
        return importedName === "default" ? images.legacyImage : null;
      case "next/head":
        return importedName === "default" ? stubValue(head) : null;
      case "next/document":
        return documentValue(importedName);
      case "next/script":
        return importedName === "default" ? stubValue(scriptStub(options.kind)) : null;
      case "next/dynamic":
        return importedName === "default"
          ? nativeFunction("dynamic", (args, tools) => dynamicComponent(options, args, tools))
          : null;
      case "next/font/google":
      case "next/font/local":
        return fontLoader(importedName);
      case "next/navigation":
        return appNavigationValue(importedName, url, params);
      case "next/headers":
        return nextRequestValue(importedName, options.request ?? null, options.origin ?? null);
      case "next/router":
        return pagesRouterValue(importedName, url, params, page);
      case "next/constants":
        return Object.hasOwn(NEXT_PHASES, importedName)
          ? primitiveValue(NEXT_PHASES[importedName])
          : null;
      case STYLED_JSX_SPECIFIER:
        return importedName === "default" ? stubValue(emptyStub("JSXStyle")) : null;
      default:
        return intl.externalValues(packageName, importedName);
    }
  };
  return { externalValues, params, page, intl };
};
