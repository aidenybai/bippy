import { decode, SourceMapMappings, type SourceMapSegment } from "@jridgewell/sourcemap-codec";

import { BippySourceMapError } from "../errors.js";
import { StackFrame } from "./parse-stack.js";

export interface DecodedSourceMapSection {
  map: {
    file?: string;
    ignoredSourceIndices?: Set<number>;
    mappings: SourceMapSegment[][];
    names?: string[];
    sourceRoot?: string;
    sources: string[];
    sourcesContent?: Array<string | null>;
    version: 3;
  };
  offset: {
    column: number;
    line: number;
  };
}

export interface IndexSourceMap {
  file?: string;
  sections: Array<{
    map?: StandardSourceMap;
    offset: {
      column: number;
      line: number;
    };
    url?: string;
  }>;
  version: 3;
}

export interface SourceFetch {
  (url: string, init?: RequestInit): Promise<Response>;
}

export interface SourceMapRequestOptions {
  allowUnsafeServerFetch?: boolean;
  maxBundleSizeBytes?: number;
  maxSourceMapSizeBytes?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SourceMap {
  file?: string;
  ignoredSourceIndices?: Set<number>;
  mappings: SourceMapSegment[][];
  names?: string[];
  sections?: DecodedSourceMapSection[];
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  version: 3;
}

export interface StandardSourceMap {
  file?: string;
  ignoreList?: number[];
  mappings: string;
  names?: string[];
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  version: 3;
  x_google_ignoreList?: number[];
}

const SCHEME_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
const INLINE_SOURCEMAP_REGEX = /^data:application\/json(?:;[^,]*)?,/i;
const SOURCEMAP_REGEX =
  /(?:\/\/[@#][ \t]+sourceMappingURL=([^\s'"]+?)[ \t]*$)|(?:\/\*[@#][ \t]+sourceMappingURL=([^*]+?)[ \t]*(?:\*\/)[ \t]*$)/;

export const sourceMapCache = new Map<string, null | SourceMap>();
const sourceMapCachesByFetch = new WeakMap<SourceFetch, Map<string, null | SourceMap>>();
interface SourceMapResult {
  sourceMap: null | SourceMap;
  isTransientFailure: boolean;
}

class TransientSourceMapError extends Error {}

const _pendingSourceMapRequests = new Map<string, Promise<SourceMapResult>>();
const pendingSourceMapRequestsByFetch = new WeakMap<
  SourceFetch,
  Map<string, Promise<SourceMapResult>>
>();
const defaultMaxBundleSizeBytes = 25 * 1024 * 1024;
const defaultMaxSourceMapSizeBytes = 100 * 1024 * 1024;

const getSourceFromMappings = (
  mappings: SourceMapMappings,
  sources: string[],
  lineIndexInMappings: number,
  column: number,
  ignoredSourceIndices?: Set<number>,
): StackFrame | null => {
  if (lineIndexInMappings < 0 || lineIndexInMappings >= mappings.length) {
    return null;
  }

  const lineMapping = mappings[lineIndexInMappings];
  if (!lineMapping || lineMapping.length === 0) {
    return null;
  }

  let closestLineSegment: null | SourceMapSegment = null;
  let lowIndex = 0;
  let highIndex = lineMapping.length - 1;
  while (lowIndex <= highIndex) {
    const middleIndex = (lowIndex + highIndex) >> 1;
    if (lineMapping[middleIndex][0] <= column) {
      closestLineSegment = lineMapping[middleIndex];
      lowIndex = middleIndex + 1;
    } else {
      highIndex = middleIndex - 1;
    }
  }

  if (!closestLineSegment || closestLineSegment.length < 4) {
    return null;
  }

  const [, sourceIndex, sourceLine, sourceColumn] = closestLineSegment;

  if (sourceIndex === undefined || sourceLine === undefined || sourceColumn === undefined) {
    return null;
  }

  const fileName = sources[sourceIndex];

  if (!fileName) {
    return null;
  }

  return {
    columnNumber: sourceColumn,
    fileName,
    lineNumber: sourceLine + 1,
    isIgnoreListed: ignoredSourceIndices?.has(sourceIndex) ?? false,
  };
};

export const getSourceFromSourceMap = (
  sourceMap: SourceMap,
  line: number,
  column: number,
): StackFrame | null => {
  if (sourceMap.sections) {
    const lineIndex = line - 1;
    let targetSection: DecodedSourceMapSection | null = null;

    for (const section of sourceMap.sections) {
      if (
        lineIndex > section.offset.line ||
        (lineIndex === section.offset.line && column >= section.offset.column)
      ) {
        targetSection = section;
      } else {
        break;
      }
    }

    if (!targetSection) {
      return null;
    }

    const relativeLine = lineIndex - targetSection.offset.line;
    const relativeColumn =
      lineIndex === targetSection.offset.line ? column - targetSection.offset.column : column;

    return getSourceFromMappings(
      targetSection.map.mappings,
      targetSection.map.sources,
      relativeLine,
      relativeColumn,
      targetSection.map.ignoredSourceIndices,
    );
  }

  return getSourceFromMappings(
    sourceMap.mappings,
    sourceMap.sources,
    line - 1,
    column,
    sourceMap.ignoredSourceIndices,
  );
};

const resolveUrl = (reference: string, baseUrl: string): string | null => {
  if (INLINE_SOURCEMAP_REGEX.test(reference)) return reference;
  try {
    return new URL(reference, baseUrl).toString();
  } catch {
    try {
      const resolvedUrl = new URL(reference, new URL(baseUrl, "https://bippy.invalid/"));
      return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
    } catch {
      return null;
    }
  }
};

const getSourceMapUrl = (url: string, content: string): null | string => {
  let sourceMapUrl: string | undefined;
  let searchEnd = content.length;
  while (searchEnd > 0 && !sourceMapUrl) {
    const lineStart = content.lastIndexOf("\n", searchEnd - 1) + 1;
    const regexMatch = content.slice(lineStart, searchEnd).match(SOURCEMAP_REGEX);
    if (regexMatch) {
      sourceMapUrl = regexMatch[1] || regexMatch[2];
    }
    searchEnd = lineStart - 1;
  }

  if (!sourceMapUrl) {
    return null;
  }

  return resolveUrl(sourceMapUrl, url);
};

const isStandardSourceMap = (value: unknown): value is StandardSourceMap => {
  if (typeof value !== "object" || value === null) return false;
  const version = Reflect.get(value, "version");
  const mappings = Reflect.get(value, "mappings");
  const file = Reflect.get(value, "file");
  const names = Reflect.get(value, "names");
  const sourceRoot = Reflect.get(value, "sourceRoot");
  const sources = Reflect.get(value, "sources");
  const sourcesContent = Reflect.get(value, "sourcesContent");
  const ignoreList = Reflect.get(value, "ignoreList");
  const googleIgnoreList = Reflect.get(value, "x_google_ignoreList");
  if (
    version !== 3 ||
    typeof mappings !== "string" ||
    (file !== undefined && typeof file !== "string") ||
    (names !== undefined &&
      (!Array.isArray(names) || names.some((entry) => typeof entry !== "string"))) ||
    (sourceRoot !== undefined && typeof sourceRoot !== "string") ||
    (sourcesContent !== undefined &&
      (!Array.isArray(sourcesContent) ||
        sourcesContent.some((entry) => typeof entry !== "string" && entry !== null))) ||
    (ignoreList !== undefined &&
      (!Array.isArray(ignoreList) ||
        ignoreList.some((entry) => !Number.isInteger(entry) || entry < 0))) ||
    (googleIgnoreList !== undefined &&
      (!Array.isArray(googleIgnoreList) ||
        googleIgnoreList.some((entry) => !Number.isInteger(entry) || entry < 0)))
  ) {
    return false;
  }
  if (!Array.isArray(sources) || sources.some((entry) => typeof entry !== "string")) return false;
  if (sourcesContent && sourcesContent.length !== sources.length) return false;
  const sourceCount = sources.length;
  return [...(ignoreList ?? []), ...(googleIgnoreList ?? [])].every(
    (sourceIndex) => sourceIndex < sourceCount,
  );
};

const isIndexSourceMap = (value: unknown): value is IndexSourceMap => {
  if (typeof value !== "object" || value === null) return false;
  const version = Reflect.get(value, "version");
  const sections = Reflect.get(value, "sections");
  if (version !== 3 || !Array.isArray(sections)) {
    return false;
  }
  return sections.every((section: unknown) => {
    if (typeof section !== "object" || section === null) return false;
    const map = Reflect.get(section, "map");
    const url = Reflect.get(section, "url");
    const offset = Reflect.get(section, "offset");
    if (typeof offset !== "object" || offset === null) return false;
    const offsetColumn = Reflect.get(offset, "column");
    const offsetLine = Reflect.get(offset, "line");
    const hasMap = isStandardSourceMap(map);
    const hasUrl = typeof url === "string" && url.length > 0;
    return (
      hasMap !== hasUrl &&
      typeof offsetColumn === "number" &&
      Number.isInteger(offsetColumn) &&
      offsetColumn >= 0 &&
      typeof offsetLine === "number" &&
      Number.isInteger(offsetLine) &&
      offsetLine >= 0
    );
  });
};

const getIgnoredSourceIndices = (rawSourceMap: StandardSourceMap): Set<number> | undefined => {
  const ignoreList = rawSourceMap.ignoreList ?? rawSourceMap.x_google_ignoreList;
  return Array.isArray(ignoreList) && ignoreList.length > 0 ? new Set(ignoreList) : undefined;
};

const resolveSourceRoot = (
  sourceRoot: string | undefined,
  source: string,
  sourceMapUrl: string,
): string => {
  if (!sourceRoot || SCHEME_REGEX.test(source) || source.startsWith("/")) return source;
  const normalizedSourceRoot = sourceRoot.endsWith("/") ? sourceRoot : `${sourceRoot}/`;
  const normalizedSource = source.replace(/^\.\//, "");
  try {
    const baseUrl = SCHEME_REGEX.test(normalizedSourceRoot)
      ? normalizedSourceRoot
      : new URL(normalizedSourceRoot, sourceMapUrl).toString();
    return new URL(normalizedSource, baseUrl).toString();
  } catch {
    const pathSegments = `${normalizedSourceRoot}${normalizedSource}`.split("/");
    const normalizedPathSegments: string[] = [];
    for (const pathSegment of pathSegments) {
      if (pathSegment === "..") {
        normalizedPathSegments.pop();
      } else if (pathSegment !== ".") {
        normalizedPathSegments.push(pathSegment);
      }
    }
    return normalizedPathSegments.join("/");
  }
};

const resolveSourceMapSources = (rawSourceMap: StandardSourceMap, sourceMapUrl: string): string[] =>
  rawSourceMap.sources.map((source) =>
    resolveSourceRoot(rawSourceMap.sourceRoot, source, sourceMapUrl),
  );

const decodeStandardSourceMap = (
  rawSourceMap: StandardSourceMap,
  sourceMapUrl: string,
): SourceMap | null => {
  try {
    return {
      file: rawSourceMap.file,
      ignoredSourceIndices: getIgnoredSourceIndices(rawSourceMap),
      mappings: decode(rawSourceMap.mappings),
      names: rawSourceMap.names,
      sourceRoot: rawSourceMap.sourceRoot,
      sources: resolveSourceMapSources(rawSourceMap, sourceMapUrl),
      sourcesContent: rawSourceMap.sourcesContent,
      version: 3,
    };
  } catch {
    return null;
  }
};

interface LoadStandardSourceMap {
  (url: string): Promise<StandardSourceMap | null>;
}

const decodeIndexSourceMap = async (
  rawSourceMap: IndexSourceMap,
  sourceMapUrl: string,
  loadStandardSourceMap: LoadStandardSourceMap,
): Promise<SourceMap | null> => {
  const decodedSections: DecodedSourceMapSection[] = [];
  let previousOffsetLine = -1;
  let previousOffsetColumn = -1;
  for (const section of rawSourceMap.sections) {
    if (
      section.offset.line < previousOffsetLine ||
      (section.offset.line === previousOffsetLine && section.offset.column <= previousOffsetColumn)
    ) {
      return null;
    }
    previousOffsetLine = section.offset.line;
    previousOffsetColumn = section.offset.column;
    const sectionUrl = section.url ? resolveUrl(section.url, sourceMapUrl) : null;
    const map = section.map ?? (sectionUrl ? await loadStandardSourceMap(sectionUrl) : null);
    if (!map) return null;
    const sectionSourceMapUrl = sectionUrl ?? sourceMapUrl;
    try {
      decodedSections.push({
        map: {
          ...map,
          ignoredSourceIndices: getIgnoredSourceIndices(map),
          mappings: decode(map.mappings),
          sources: resolveSourceMapSources(map, sectionSourceMapUrl),
        },
        offset: section.offset,
      });
    } catch {
      return null;
    }
  }

  const allSources = new Set<string>();
  for (const section of decodedSections) {
    for (const source of section.map.sources) {
      allSources.add(source);
    }
  }

  return {
    file: rawSourceMap.file,
    mappings: [],
    names: [],
    sections: decodedSections,
    sourceRoot: undefined,
    sources: Array.from(allSources),
    sourcesContent: undefined,
    version: 3,
  };
};

const isFetchableUrl = (url: string): boolean => {
  if (!url) {
    return false;
  }

  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    return false;
  }

  const schemeMatch = trimmedUrl.match(SCHEME_REGEX);

  if (!schemeMatch) {
    return true;
  }

  const scheme = schemeMatch[0].toLowerCase();

  return scheme === "http:" || scheme === "https:";
};

const isServerRuntime = (): boolean =>
  typeof window === "undefined" &&
  typeof process !== "undefined" &&
  typeof process.versions?.node === "string";

const isAbsoluteHttpUrl = (url: string): boolean => {
  try {
    const parsedUrl = new URL(url);
    return (
      (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") &&
      !parsedUrl.username &&
      !parsedUrl.password
    );
  } catch {
    return false;
  }
};

const isSameOrigin = (firstUrl: string, secondUrl: string): boolean => {
  try {
    return new URL(firstUrl).origin === new URL(secondUrl).origin;
  } catch {
    return false;
  }
};

const isTransientHttpStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const assertResponseIsCacheable = (response: Response): boolean => {
  if (response.ok) return true;
  if (isTransientHttpStatus(response.status)) {
    throw new TransientSourceMapError();
  }
  return false;
};

interface RequestSignal {
  cleanup: () => void;
  signal?: AbortSignal;
}

const createRequestSignal = (options: SourceMapRequestOptions): RequestSignal => {
  if (!options.signal && options.timeoutMs === undefined) {
    return { cleanup: () => {} };
  }
  const abortController = new AbortController();
  const abortFromSource = (): void => abortController.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    abortFromSource();
  } else {
    options.signal?.addEventListener("abort", abortFromSource, { once: true });
  }
  const timeoutHandle =
    options.timeoutMs !== undefined && options.timeoutMs >= 0
      ? setTimeout(
          () => abortController.abort(new BippySourceMapError("Source map request timed out")),
          options.timeoutMs,
        )
      : undefined;
  return {
    cleanup: () => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      options.signal?.removeEventListener("abort", abortFromSource);
    },
    signal: abortController.signal,
  };
};

const readResponseText = async (
  response: Response,
  maxSizeBytes: number,
): Promise<string | null> => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxSizeBytes) return null;
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const decodedChunks: string[] = [];
  let totalSizeBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSizeBytes += value.byteLength;
      if (totalSizeBytes > maxSizeBytes) {
        await reader.cancel();
        return null;
      }
      decodedChunks.push(decoder.decode(value, { stream: true }));
    }
    decodedChunks.push(decoder.decode());
    return decodedChunks.join("");
  } finally {
    reader.releaseLock();
  }
};

const decodeBase64 = (encodedContent: string): string | null => {
  try {
    if (typeof globalThis.atob === "function") {
      return new TextDecoder().decode(
        Uint8Array.from(globalThis.atob(encodedContent), (character) => character.charCodeAt(0)),
      );
    }
  } catch {
    return null;
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const normalizedContent = encodedContent.replace(/\s/g, "").replace(/=+$/, "");
  const bytes: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  for (const character of normalizedContent) {
    const value = alphabet.indexOf(character);
    if (value === -1) return null;
    bitBuffer = bitBuffer * 64 + value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push(Math.floor(bitBuffer / 2 ** bitCount) & 255);
      bitBuffer %= 2 ** bitCount;
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
};

const readInlineSourceMap = (sourceMapUrl: string, maxSizeBytes: number): unknown => {
  const commaIndex = sourceMapUrl.indexOf(",");
  if (commaIndex === -1) return null;
  const metadata = sourceMapUrl.slice(0, commaIndex);
  const encodedContent = sourceMapUrl.slice(commaIndex + 1);
  if (encodedContent.length > maxSizeBytes * 2) return null;
  try {
    const content = metadata.toLowerCase().includes(";base64")
      ? decodeBase64(encodedContent)
      : decodeURIComponent(encodedContent);
    if (content === null) return null;
    if (new TextEncoder().encode(content).byteLength > maxSizeBytes) return null;
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const readSourceMapDocument = async (
  sourceMapUrl: string,
  sourceFetch: SourceFetch,
  signal: AbortSignal | undefined,
  maxSizeBytes: number,
  shouldRejectRedirects: boolean,
): Promise<unknown> => {
  if (INLINE_SOURCEMAP_REGEX.test(sourceMapUrl)) {
    return readInlineSourceMap(sourceMapUrl, maxSizeBytes);
  }
  const sourceMapResponse = await sourceFetch(sourceMapUrl, {
    redirect: shouldRejectRedirects ? "error" : "follow",
    signal,
  });
  if (!assertResponseIsCacheable(sourceMapResponse)) return null;
  const sourceMapContent = await readResponseText(sourceMapResponse, maxSizeBytes);
  if (sourceMapContent === null) return null;
  try {
    return JSON.parse(sourceMapContent);
  } catch {
    return null;
  }
};

const getSourceMapUncachedInternal = async (
  bundleUrl: string,
  fetchFn?: SourceFetch,
  options: SourceMapRequestOptions = {},
): Promise<null | SourceMap> => {
  if (!isFetchableUrl(bundleUrl)) {
    return null;
  }

  const shouldRejectRedirects = isServerRuntime();
  if (shouldRejectRedirects) {
    if ((!fetchFn && !options.allowUnsafeServerFetch) || !isAbsoluteHttpUrl(bundleUrl)) return null;
  }

  const sourceFetch =
    fetchFn ??
    (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);
  if (!sourceFetch) return null;
  const maxBundleSizeBytes = options.maxBundleSizeBytes ?? defaultMaxBundleSizeBytes;
  const maxSourceMapSizeBytes = options.maxSourceMapSizeBytes ?? defaultMaxSourceMapSizeBytes;
  if (maxBundleSizeBytes < 0 || maxSourceMapSizeBytes < 0) return null;
  const requestSignal = createRequestSignal(options);
  try {
    const bundleResponse = await sourceFetch(bundleUrl, {
      redirect: shouldRejectRedirects ? "error" : "follow",
      signal: requestSignal.signal,
    });
    if (!assertResponseIsCacheable(bundleResponse)) return null;
    const bundleContent = await readResponseText(bundleResponse, maxBundleSizeBytes);
    if (!bundleContent) return null;
    const sourceMapUrl = getSourceMapUrl(bundleUrl, bundleContent);
    if (!sourceMapUrl) return null;
    if (!isFetchableUrl(sourceMapUrl) && !INLINE_SOURCEMAP_REGEX.test(sourceMapUrl)) return null;
    if (
      shouldRejectRedirects &&
      !INLINE_SOURCEMAP_REGEX.test(sourceMapUrl) &&
      !isSameOrigin(bundleUrl, sourceMapUrl)
    ) {
      return null;
    }

    const rawSourceMap = await readSourceMapDocument(
      sourceMapUrl,
      sourceFetch,
      requestSignal.signal,
      maxSourceMapSizeBytes,
      shouldRejectRedirects,
    );
    if (isStandardSourceMap(rawSourceMap)) {
      return decodeStandardSourceMap(rawSourceMap, sourceMapUrl);
    }
    if (!isIndexSourceMap(rawSourceMap)) return null;
    return decodeIndexSourceMap(rawSourceMap, sourceMapUrl, async (sectionUrl) => {
      if (
        shouldRejectRedirects &&
        !INLINE_SOURCEMAP_REGEX.test(sectionUrl) &&
        !isSameOrigin(bundleUrl, sectionUrl)
      ) {
        return null;
      }
      const sectionSourceMap = await readSourceMapDocument(
        sectionUrl,
        sourceFetch,
        requestSignal.signal,
        maxSourceMapSizeBytes,
        shouldRejectRedirects,
      );
      return isStandardSourceMap(sectionSourceMap) ? sectionSourceMap : null;
    });
  } finally {
    requestSignal.cleanup();
  }
};

export const getSourceMapUncached = async (
  bundleUrl: string,
  fetchFn?: SourceFetch,
  options: SourceMapRequestOptions = {},
): Promise<null | SourceMap> => {
  try {
    return await getSourceMapUncachedInternal(bundleUrl, fetchFn, options);
  } catch (error) {
    if (error instanceof TransientSourceMapError) return null;
    throw error;
  }
};

const getSourceMapCache = (fetchFn: SourceFetch | undefined): Map<string, null | SourceMap> => {
  if (!fetchFn) return sourceMapCache;
  let cache = sourceMapCachesByFetch.get(fetchFn);
  if (!cache) {
    cache = new Map();
    sourceMapCachesByFetch.set(fetchFn, cache);
  }
  return cache;
};

const getPendingSourceMapRequests = (
  fetchFn: SourceFetch | undefined,
): Map<string, Promise<SourceMapResult>> => {
  if (!fetchFn) return _pendingSourceMapRequests;
  let pendingRequests = pendingSourceMapRequestsByFetch.get(fetchFn);
  if (!pendingRequests) {
    pendingRequests = new Map();
    pendingSourceMapRequestsByFetch.set(fetchFn, pendingRequests);
  }
  return pendingRequests;
};

const getSourceMapCacheKey = (file: string, options: SourceMapRequestOptions): string =>
  options.allowUnsafeServerFetch === undefined &&
  options.maxBundleSizeBytes === undefined &&
  options.maxSourceMapSizeBytes === undefined &&
  options.timeoutMs === undefined
    ? file
    : `${file}\0${options.allowUnsafeServerFetch ?? ""}\0${options.maxBundleSizeBytes ?? ""}\0${options.maxSourceMapSizeBytes ?? ""}\0${options.timeoutMs ?? ""}`;

export const getSourceMap = async (
  file: string,
  useCache = true,
  fetchFn?: SourceFetch,
  options: SourceMapRequestOptions = {},
): Promise<null | SourceMap> => {
  const shouldUseCache = useCache && options.signal === undefined;
  const cache = getSourceMapCache(fetchFn);
  const pendingRequests = getPendingSourceMapRequests(fetchFn);
  const cacheKey = getSourceMapCacheKey(file, options);
  if (shouldUseCache && cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }

  const pendingRequest = shouldUseCache ? pendingRequests.get(cacheKey) : undefined;
  if (pendingRequest) {
    return (await pendingRequest).sourceMap;
  }

  const fetchPromise: Promise<SourceMapResult> = getSourceMapUncachedInternal(
    file,
    fetchFn,
    options,
  ).then(
    (sourceMap) => ({ sourceMap, isTransientFailure: false }),
    () => ({ sourceMap: null, isTransientFailure: true }),
  );
  if (shouldUseCache) {
    pendingRequests.set(cacheKey, fetchPromise);
  }

  const { sourceMap, isTransientFailure } = await fetchPromise;
  if (shouldUseCache) {
    pendingRequests.delete(cacheKey);
    if (!isTransientFailure) {
      cache.set(cacheKey, sourceMap);
    }
  }

  return sourceMap;
};

export const symbolicateStack = async (
  stack: StackFrame[],
  cache = true,
  fetchFn?: (url: string) => Promise<Response>,
): Promise<StackFrame[]> => {
  return Promise.all(
    stack.map(async (stackFrame) => {
      if (!stackFrame.fileName) return stackFrame;
      const sourceMap = await getSourceMap(stackFrame.fileName, cache, fetchFn);
      if (
        !sourceMap ||
        typeof stackFrame.lineNumber !== "number" ||
        typeof stackFrame.columnNumber !== "number"
      ) {
        return stackFrame;
      }
      const symbolicatedSource = getSourceFromSourceMap(
        sourceMap,
        stackFrame.lineNumber,
        stackFrame.columnNumber,
      );
      if (!symbolicatedSource) return stackFrame;
      return {
        ...stackFrame,
        source:
          symbolicatedSource.fileName && stackFrame.source
            ? stackFrame.source.replace(stackFrame.fileName, symbolicatedSource.fileName)
            : stackFrame.source,
        fileName: symbolicatedSource.fileName,
        lineNumber: symbolicatedSource.lineNumber,
        columnNumber: symbolicatedSource.columnNumber,
        isIgnoreListed: symbolicatedSource.isIgnoreListed,
        isSymbolicated: true,
      };
    }),
  );
};
