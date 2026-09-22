import {
  ABOUT_REACT_PREFIX,
  ANONYMOUS_FILE_PATTERNS,
  BUNDLED_FILE_PATTERN_REGEX,
  INTERNAL_SCHEME_PREFIXES,
  QUERY_PARAMETER_PATTERN_REGEX,
  SCHEME_REGEX,
  SOURCE_FILE_EXTENSION_REGEX,
} from "./constants.js";

const VITE_FS_PREFIX = "/@fs/";
const VITE_ID_PREFIX = "/@id/";
const VITE_NULL_BYTE_PLACEHOLDER = "__x00__";
const NEXT_WEBPACK_NAMESPACE = "_N_E/";
const TURBOPACK_PROJECT_TOKEN = "[project]/";
const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:[\\/]/;
const WINDOWS_DRIVE_SEGMENT = /^[a-zA-Z]:$/;
const APP_PAGES_BROWSER_PREFIX = /^\/?(?:app-pages-browser|\(app-pages-browser\))\//;
const NEXT_BUNDLER_LAYER_PREFIX =
  /^\/?\((?:action-browser|api-edge|api-node|edge-asset|instrument|middleware|pages-dir-browser|pages-dir-edge|pages-dir-node|rsc|shared|ssr)\)\//;
const ENCODED_SEPARATOR = /%(?:2f|5c)/i;

const isWindowsDrivePath = (filePath: string): boolean => WINDOWS_DRIVE_PREFIX.test(filePath);

const decodePath = (filePath: string): string => {
  if (!filePath.includes("%")) return filePath;
  return filePath
    .split("/")
    .map((segment) => {
      if (!segment.includes("%") || ENCODED_SEPARATOR.test(segment)) return segment;
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
};

const resolveFileProtocol = (specifier: string): string => {
  const afterScheme = specifier.slice("file://".length);
  const postfixIndex = afterScheme.search(/[?#]/);
  const pathWithHost = postfixIndex === -1 ? afterScheme : afterScheme.slice(0, postfixIndex);

  let hostname = "";
  let pathname = pathWithHost;
  if (pathWithHost.startsWith("/")) {
    pathname = pathWithHost.replace(/^\/+/, "/");
  } else if (isWindowsDrivePath(pathWithHost)) {
    pathname = pathWithHost;
  } else {
    const slashIndex = pathWithHost.indexOf("/");
    hostname = slashIndex === -1 ? pathWithHost : pathWithHost.slice(0, slashIndex);
    pathname = slashIndex === -1 ? "/" : pathWithHost.slice(slashIndex);
  }

  if (hostname.toLowerCase() === "localhost") hostname = "";
  if (hostname) {
    return `//${hostname}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  }

  if (pathname.startsWith("/") && isWindowsDrivePath(pathname.slice(1))) {
    return pathname.slice(1);
  }
  if (isWindowsDrivePath(pathname)) return pathname;
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
};

const unwrapViteId = (filePath: string): string => {
  if (filePath.startsWith(VITE_FS_PREFIX)) {
    const absolutePath = filePath.slice(VITE_FS_PREFIX.length);
    if (isWindowsDrivePath(absolutePath)) return absolutePath;
    return absolutePath.startsWith("/") ? absolutePath : `/${absolutePath}`;
  }

  if (!filePath.startsWith(VITE_ID_PREFIX)) return filePath;
  const unwrappedId = filePath
    .slice(VITE_ID_PREFIX.length)
    .replaceAll(VITE_NULL_BYTE_PLACEHOLDER, "\0");
  if (unwrappedId.startsWith("\0") || unwrappedId.startsWith("virtual:")) return "";
  return unwrappedId;
};

const stripWebpackNamespace = (filePath: string): string => {
  if (filePath.startsWith(NEXT_WEBPACK_NAMESPACE)) {
    return filePath.slice(NEXT_WEBPACK_NAMESPACE.length);
  }
  const slashIndex = filePath.indexOf("/");
  if (slashIndex <= 0) return filePath;
  const remainder = filePath.slice(slashIndex + 1);
  if (remainder.startsWith("./") || remainder.startsWith("../")) return remainder;
  return filePath;
};

const stripBundlerLayer = (filePath: string, didStripBundlerScheme: boolean): string => {
  const appPagesMatch = filePath.match(APP_PAGES_BROWSER_PREFIX);
  if (appPagesMatch?.[0]) return filePath.slice(appPagesMatch[0].length);
  if (!didStripBundlerScheme) return filePath;
  const layerMatch = filePath.match(NEXT_BUNDLER_LAYER_PREFIX);
  if (!layerMatch?.[0]) return filePath;
  return filePath.slice(layerMatch[0].length);
};

const stripUrlPostfix = (filePath: string): string => {
  const hashIndex = filePath.indexOf("#");
  const withoutHash = hashIndex === -1 ? filePath : filePath.slice(0, hashIndex);
  const queryParameterIndex = withoutHash.indexOf("?");
  if (queryParameterIndex === -1) return withoutHash;
  const potentialQueryParameters = withoutHash.slice(queryParameterIndex);
  if (!QUERY_PARAMETER_PATTERN_REGEX.test(potentialQueryParameters)) return withoutHash;
  return withoutHash.slice(0, queryParameterIndex);
};

const normalizeLexicalPath = (filePath: string): string => {
  if (!filePath || filePath.includes("\\")) return filePath;
  const isAbsolute = filePath.startsWith("/");
  const isNetworkPath = filePath.startsWith("//");
  const hasRelativeDotPrefix = filePath.startsWith("./");
  const normalizedSegments: string[] = [];

  for (const segment of filePath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      const previousSegment = normalizedSegments[normalizedSegments.length - 1];
      if (
        previousSegment &&
        previousSegment !== ".." &&
        (!isNetworkPath || normalizedSegments.length > 2) &&
        !WINDOWS_DRIVE_SEGMENT.test(previousSegment)
      ) {
        normalizedSegments.pop();
      } else if (!isAbsolute && !WINDOWS_DRIVE_SEGMENT.test(previousSegment ?? "")) {
        normalizedSegments.push("..");
      }
      continue;
    }
    normalizedSegments.push(segment);
  }

  if (isAbsolute) return `${isNetworkPath ? "//" : "/"}${normalizedSegments.join("/")}`;
  const joinedPath = normalizedSegments.join("/");
  if (!joinedPath) return hasRelativeDotPrefix ? "./" : "";
  if (hasRelativeDotPrefix && !joinedPath.startsWith("../")) return `./${joinedPath}`;
  return joinedPath;
};

export const normalizeFileName = (fileName: string): string => {
  if (!fileName) return "";
  if (ANONYMOUS_FILE_PATTERNS.some((pattern) => pattern === fileName)) return "";

  let normalizedFileName = fileName;
  let didStripWebpackScheme = false;
  let didStripBundlerScheme = false;
  let didResolveFileProtocol = false;

  const isHttpUrl =
    normalizedFileName.startsWith("http://") || normalizedFileName.startsWith("https://");
  if (isHttpUrl) {
    try {
      normalizedFileName = new URL(normalizedFileName).pathname;
    } catch {}
    normalizedFileName = stripSingleBasePathPrefix(normalizedFileName);
  }

  if (normalizedFileName.startsWith(ABOUT_REACT_PREFIX)) {
    const remainder = normalizedFileName.slice(ABOUT_REACT_PREFIX.length);
    const slashIndex = remainder.indexOf("/");
    const colonIndex = remainder.indexOf(":");
    normalizedFileName =
      slashIndex !== -1 && (colonIndex === -1 || slashIndex < colonIndex)
        ? remainder.slice(slashIndex + 1)
        : remainder;
  }

  let didStripPrefix = true;
  while (didStripPrefix) {
    didStripPrefix = false;
    if (normalizedFileName.startsWith("file://")) {
      const resolvedFilePath = resolveFileProtocol(normalizedFileName);
      if (resolvedFilePath === normalizedFileName) break;
      normalizedFileName = resolvedFilePath;
      didResolveFileProtocol = true;
      didStripPrefix = true;
      continue;
    }
    for (const prefix of INTERNAL_SCHEME_PREFIXES) {
      if (!normalizedFileName.startsWith(prefix)) continue;
      if (prefix === "webpack://") didStripWebpackScheme = true;
      if (
        prefix === "webpack://" ||
        prefix === "webpack-internal://" ||
        prefix === "turbopack://"
      ) {
        didStripBundlerScheme = true;
      }
      normalizedFileName = normalizedFileName.slice(prefix.length);
      didStripPrefix = true;
      break;
    }
  }

  if (normalizedFileName.startsWith("virtual:")) return "";

  if (!isWindowsDrivePath(normalizedFileName)) {
    const schemeMatch = normalizedFileName.match(SCHEME_REGEX);
    if (schemeMatch) normalizedFileName = normalizedFileName.slice(schemeMatch[0].length);
  }

  if (!didResolveFileProtocol && normalizedFileName.startsWith("//")) {
    const firstPathSlashIndex = normalizedFileName.indexOf("/", 2);
    normalizedFileName =
      firstPathSlashIndex === -1 ? "" : normalizedFileName.slice(firstPathSlashIndex);
  }

  normalizedFileName = unwrapViteId(normalizedFileName);
  if (didStripWebpackScheme) normalizedFileName = stripWebpackNamespace(normalizedFileName);
  normalizedFileName = stripBundlerLayer(normalizedFileName, didStripBundlerScheme);
  if (normalizedFileName.startsWith(TURBOPACK_PROJECT_TOKEN)) {
    normalizedFileName = `./${normalizedFileName.slice(TURBOPACK_PROJECT_TOKEN.length)}`;
  } else if (normalizedFileName.startsWith(`/${TURBOPACK_PROJECT_TOKEN}`)) {
    normalizedFileName = normalizedFileName.slice(TURBOPACK_PROJECT_TOKEN.length);
  }
  normalizedFileName = stripUrlPostfix(normalizedFileName);
  normalizedFileName = decodePath(normalizedFileName);
  return normalizeLexicalPath(normalizedFileName);
};

const getPathSegmentCount = (path: string): number => path.split("/").filter(Boolean).length;

const stripSingleBasePathPrefix = (path: string): string => {
  const firstSlashIndex = path.indexOf("/", 1);
  if (firstSlashIndex === -1) return path;

  const basePath = path.slice(0, firstSlashIndex);
  if (getPathSegmentCount(basePath) !== 1) return path;
  if (basePath === "/@fs" || basePath === "/@id") return path;

  const remainderPath = path.slice(firstSlashIndex);
  if (!SOURCE_FILE_EXTENSION_REGEX.test(remainderPath)) return path;

  const remainderSegments = remainderPath.split("/").filter(Boolean);
  if (remainderSegments.length < 2) return path;

  const firstRemainderSegment = remainderSegments[0];
  if (!firstRemainderSegment || firstRemainderSegment.startsWith("@")) return path;
  if (firstRemainderSegment.length > 4) return path;
  return remainderPath;
};

export const isSourceFile = (fileName: string): boolean => {
  const normalizedFileName = normalizeFileName(fileName);
  if (!normalizedFileName) return false;
  if (normalizedFileName.includes("\0") || normalizedFileName.startsWith("virtual:")) return false;
  if (!SOURCE_FILE_EXTENSION_REGEX.test(normalizedFileName)) return false;
  if (BUNDLED_FILE_PATTERN_REGEX.test(normalizedFileName)) return false;
  return true;
};
