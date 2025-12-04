import {
  decode,
  SourceMapMappings,
  type SourceMapSegment,
} from '@jridgewell/sourcemap-codec';

import { StackFrame } from './parse-stack.js';

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

const supportsWeakRef = typeof WeakRef !== 'undefined';

export const sourceMapCache = new Map<
  string,
  null | SourceMap | WeakRef<SourceMap>
>();
const _pendingSourceMapRequests = new Map<
  string,
  null | Promise<null | SourceMap>
>();

const isWeakRefSourceMap = (
  cachedValue: SourceMap | WeakRef<SourceMap>,
): cachedValue is WeakRef<SourceMap> => {
  return supportsWeakRef && cachedValue instanceof WeakRef;
};

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

  let closestLineSegment: null | SourceMapSegment = null;
  for (const lineSegment of lineMapping) {
    if (lineSegment[0] <= column) {
      closestLineSegment = lineSegment;
    } else {
      break;
    }
  }

  if (!closestLineSegment || closestLineSegment.length < 4) {
    return null;
  }

  const [, sourceIndex, sourceLine, sourceColumn] = closestLineSegment;

  if (
    sourceIndex === undefined ||
    sourceLine === undefined ||
    sourceColumn === undefined
  ) {
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
      line === targetSection.offset.line
        ? column - targetSection.offset.column
        : column;

    return getSourceFromMappings(
      targetSection.map.mappings,
      targetSection.map.sources,
      relativeLine,
      relativeColumn,
    );
  }

  return getSourceFromMappings(
    sourceMap.mappings,
    sourceMap.sources,
    line - 1,
    column,
  );
};

const getSourceMapUrl = (url: string, content: string): null | string => {
  const lines = content.split('\n');
  let sourceMapUrl: string | undefined;
  for (let i = lines.length - 1; i >= 0 && !sourceMapUrl; i--) {
    const regexMatch = lines[i].match(SOURCEMAP_REGEX);
    if (regexMatch) {
      sourceMapUrl = regexMatch[1] || regexMatch[2];
    }
  }

  if (!sourceMapUrl) {
    return null;
  }

  const hasScheme = SCHEME_REGEX.test(sourceMapUrl);
  if (
    !(
      INLINE_SOURCEMAP_REGEX.test(sourceMapUrl) ||
      hasScheme ||
      sourceMapUrl.startsWith('/')
    )
  ) {
    const urlSegments = url.split('/');
    urlSegments[urlSegments.length - 1] = sourceMapUrl;
    sourceMapUrl = urlSegments.join('/');
  }

  return sourceMapUrl;
};

const decodeStandardSourceMap = (
  rawSourceMap: StandardSourceMap,
): SourceMap => ({
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

  return scheme === 'http:' || scheme === 'https:';
};

export const getSourceMapImpl = async (
  bundleUrl: string,
  fetchFn: (url: string) => Promise<Response> = fetch,
): Promise<null | SourceMap> => {
  if (!isFetchableUrl(bundleUrl)) {
    return null;
  }

  let bundleContent: string | undefined;
  try {
    const bundleResponse = await fetchFn(bundleUrl);
    bundleContent = await bundleResponse.text();
  } catch {
    return null;
  }

  if (!bundleContent) {
    return null;
  }

  const sourceMapUrl = getSourceMapUrl(bundleUrl, bundleContent);

  if (!sourceMapUrl) return null;
  if (!isFetchableUrl(sourceMapUrl)) {
    return null;
  }

  try {
    const sourceMapResponse = await fetchFn(sourceMapUrl);
    const rawSourceMap = (await sourceMapResponse.json()) as RawSourceMap;

    return 'sections' in rawSourceMap
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
    const cachedValue = sourceMapCache.get(file);
    if (cachedValue === null || cachedValue === undefined) {
      return null;
    }
    if (isWeakRefSourceMap(cachedValue)) {
      const sourceMap = cachedValue.deref();
      if (sourceMap) {
        return sourceMap;
      }
      sourceMapCache.delete(file);
    } else {
      return cachedValue;
    }
  }

  if (useCache && _pendingSourceMapRequests.has(file)) {
    return _pendingSourceMapRequests.get(file)!;
  }

  const fetchPromise = getSourceMapImpl(file, fetchFn);
  if (useCache) {
    _pendingSourceMapRequests.set(file, fetchPromise);
  }

  const sourceMap = await fetchPromise;
  if (useCache) {
    _pendingSourceMapRequests.delete(file);
  }

  if (useCache) {
    if (sourceMap === null) {
      sourceMapCache.set(file, null);
    } else {
      sourceMapCache.set(
        file,
        supportsWeakRef ? new WeakRef(sourceMap) : sourceMap,
      );
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
        typeof stackFrame.lineNumber !== 'number' ||
        typeof stackFrame.columnNumber !== 'number'
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
            ? stackFrame.source.replace(
                stackFrame.fileName,
                symbolicatedSource.fileName,
              )
            : stackFrame.source,
        fileName: symbolicatedSource.fileName,
        lineNumber: symbolicatedSource.lineNumber,
        columnNumber: symbolicatedSource.columnNumber,
        isSymbolicated: true,
      };
    }),
  );
};
