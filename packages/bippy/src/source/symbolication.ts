import { decode, SourceMapMappings, type SourceMapSegment } from "@jridgewell/sourcemap-codec";

import { StackFrame } from "./parse-stack.js";

export interface DecodedSourceMapSection {
  map: {
    file?: string;
    mappings: SourceMapSegment[][];
    names?: string[];
    sourceRoot?: string;
    sources: string[];
    sourcesContent?: string[];
    version: 3;
  };
  offset: {
    column: number;
    line: number;
  };
}

// https://tc39.es/ecma426/#sec-index-source-map
export interface IndexSourceMap {
  file?: string;
  sections: Array<{
    map: StandardSourceMap;
    offset: {
      column: number;
      line: number;
    };
  }>;
  version: 3;
}

export type RawSourceMap = IndexSourceMap | StandardSourceMap;

export interface SourceMap {
  file?: string;
  mappings: SourceMapSegment[][];
  names?: string[];
  sections?: DecodedSourceMapSection[];
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: string[];
  version: 3;
}

// https://developer.chrome.com/blog/sourcemaps#the_anatomy_of_a_source_map
export interface StandardSourceMap {
  file?: string;
  mappings: string;
  names?: string[];
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: string[];
  version: 3;
}

// has a scheme, e.g. http://, https://, file://, data:, etc.
// https://datatracker.ietf.org/doc/html/rfc3986#section-3.1
const SCHEME_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
// inline sourcemap, e.g. data:application/json;base64,...
const INLINE_SOURCEMAP_REGEX = /^data:application\/json[^,]+base64,/;
// sourcemap url, e.g. //@ sourceMappingURL=... or /* @ sourceMappingURL=... */ at the end of the file
const SOURCEMAP_REGEX =
  /(?:\/\/[@#][ \t]+sourceMappingURL=([^\s'"]+?)[ \t]*$)|(?:\/\*[@#][ \t]+sourceMappingURL=([^*]+?)[ \t]*(?:\*\/)[ \t]*$)/;

export const sourceMapCache = new Map<string, null | SourceMap>();
interface SourceMapResult {
  sourceMap: null | SourceMap;
  isTransientFailure: boolean;
}

const _pendingSourceMapRequests = new Map<string, Promise<SourceMapResult>>();

const getSourceFromMappings = (
  mappings: SourceMapMappings,
  sources: string[],
  lineIndexInMappings: number,
  column: number,
): StackFrame | null => {
  if (lineIndexInMappings < 0 || lineIndexInMappings >= mappings.length) {
    return null;
  }

  const lineMapping = mappings[lineIndexInMappings];
  if (!lineMapping || lineMapping.length === 0) {
    return null;
  }

  // Segments within a line are sorted by generated column, and a minified
  // bundle can put tens of thousands of segments on one line, so binary search
  // for the last segment at or before the column.
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
  };
};

export const getSourceFromSourceMap = (
  sourceMap: SourceMap,
  line: number,
  column: number,
): StackFrame | null => {
  if (sourceMap.sections) {
    let targetSection: DecodedSourceMapSection | null = null;

    for (const section of sourceMap.sections) {
      if (
        line > section.offset.line ||
        (line === section.offset.line && column >= section.offset.column)
      ) {
        targetSection = section;
      } else {
        break;
      }
    }

    if (!targetSection) {
      return null;
    }

    const relativeLine = line - targetSection.offset.line;
    const relativeColumn =
      line === targetSection.offset.line ? column - targetSection.offset.column : column;

    return getSourceFromMappings(
      targetSection.map.mappings,
      targetSection.map.sources,
      relativeLine,
      relativeColumn,
    );
  }

  return getSourceFromMappings(sourceMap.mappings, sourceMap.sources, line - 1, column);
};

const getSourceMapUrl = (url: string, content: string): null | string => {
  // Walk lines from the end without content.split("\n"), which allocates a
  // string per line for the entire bundle just to find the trailer comment.
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

  const hasScheme = SCHEME_REGEX.test(sourceMapUrl);
  if (!(INLINE_SOURCEMAP_REGEX.test(sourceMapUrl) || hasScheme || sourceMapUrl.startsWith("/"))) {
    const urlSegments = url.split("/");
    urlSegments[urlSegments.length - 1] = sourceMapUrl;
    sourceMapUrl = urlSegments.join("/");
  }

  return sourceMapUrl;
};

const decodeStandardSourceMap = (rawSourceMap: StandardSourceMap): SourceMap => ({
  file: rawSourceMap.file,
  mappings: decode(rawSourceMap.mappings),
  names: rawSourceMap.names,
  sourceRoot: rawSourceMap.sourceRoot,
  sources: rawSourceMap.sources,
  sourcesContent: rawSourceMap.sourcesContent,
  version: 3,
});

const decodeIndexSourceMap = (rawSourceMap: IndexSourceMap): SourceMap => {
  const decodedSections: DecodedSourceMapSection[] = rawSourceMap.sections.map(
    ({ map, offset }) => ({
      map: {
        ...map,
        mappings: decode(map.mappings),
      },
      offset,
    }),
  );

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

// Resolves a bundle's source map, or null when the bundle definitively has
// none. A thrown fetch (network error or aborted request) is left to propagate
// so getSourceMap can treat it as transient and avoid caching it: a non-ok
// response, a missing sourceMappingURL, or an undecodable map are definitive and
// return null, but a dropped connection is not and must stay retryable.
export const getSourceMapImpl = async (
  bundleUrl: string,
  fetchFn: (url: string) => Promise<Response> = fetch,
): Promise<null | SourceMap> => {
  if (!isFetchableUrl(bundleUrl)) {
    return null;
  }

  const bundleResponse = await fetchFn(bundleUrl);
  if (!bundleResponse.ok) {
    return null;
  }
  const bundleContent = await bundleResponse.text();
  if (!bundleContent) {
    return null;
  }

  const sourceMapUrl = getSourceMapUrl(bundleUrl, bundleContent);

  if (!sourceMapUrl) return null;
  if (!isFetchableUrl(sourceMapUrl)) {
    return null;
  }

  const sourceMapResponse = await fetchFn(sourceMapUrl);
  if (!sourceMapResponse.ok) {
    return null;
  }

  try {
    const rawSourceMap = (await sourceMapResponse.json()) as RawSourceMap;

    return "sections" in rawSourceMap
      ? decodeIndexSourceMap(rawSourceMap)
      : decodeStandardSourceMap(rawSourceMap);
  } catch {
    return null;
  }
};

export const getSourceMap = async (
  file: string,
  useCache = true,
  fetchFn?: (url: string) => Promise<Response>,
): Promise<null | SourceMap> => {
  if (useCache && sourceMapCache.has(file)) {
    return sourceMapCache.get(file) ?? null;
  }

  const pendingRequest = useCache ? _pendingSourceMapRequests.get(file) : undefined;
  if (pendingRequest) {
    return (await pendingRequest).sourceMap;
  }

  // A transient fetch failure (aborted request or network error) rejects; a
  // definitive "no map" resolves to null. Only definitive results are cached:
  // caching a transient null would pin the bundle to a degraded result for the
  // rest of the page's lifetime, even after the network recovers.
  const fetchPromise: Promise<SourceMapResult> = getSourceMapImpl(file, fetchFn).then(
    (sourceMap) => ({ sourceMap, isTransientFailure: false }),
    () => ({ sourceMap: null, isTransientFailure: true }),
  );
  if (useCache) {
    _pendingSourceMapRequests.set(file, fetchPromise);
  }

  const { sourceMap, isTransientFailure } = await fetchPromise;
  if (useCache) {
    _pendingSourceMapRequests.delete(file);
    if (!isTransientFailure) {
      sourceMapCache.set(file, sourceMap);
    }
  }

  return sourceMap;
};

export const symbolicateStack = async (
  stack: StackFrame[],
  cache = true,
  fetchFn?: (url: string) => Promise<Response>,
): Promise<StackFrame[]> => {
  return await Promise.all(
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
        isSymbolicated: true,
      };
    }),
  );
};
