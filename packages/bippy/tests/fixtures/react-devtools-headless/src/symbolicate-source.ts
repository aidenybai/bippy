import { getSourceFromSourceMap, getSourceMap, type SourceFetch } from "bippy/source";
import type { ReactFunctionLocation } from "./shared-utils.js";

export interface SourceMappedLocation {
  ignored: boolean;
  location: ReactFunctionLocation;
}

export interface FetchFile {
  (url: string): Promise<string | null>;
}

const createSourceFetch =
  (fetchFile: FetchFile): SourceFetch =>
  async (url) => {
    const source = await fetchFile(url);
    return source === null ? new Response(null, { status: 404 }) : new Response(source);
  };

const resolveOriginalSourceUrl = (source: string, sourceMapUrl: string): string | null => {
  try {
    return new URL(source).toString();
  } catch {
    if (source.startsWith("/") || source.slice(1).startsWith(":\\")) return source;
    try {
      return new URL(source, sourceMapUrl).toString();
    } catch {
      return null;
    }
  }
};

export const symbolicateSource = async (
  fetchFile: FetchFile,
  sourceUrl: string,
  lineNumber: number,
  columnNumber: number,
): Promise<SourceMappedLocation | null> => {
  if (!sourceUrl || sourceUrl.startsWith("<anonymous")) return null;
  const sourceFetch = createSourceFetch(fetchFile);
  const sourceMap = await getSourceMap(sourceUrl, false, sourceFetch, {
    allowCrossOriginSourceMap: true,
  });
  if (!sourceMap) return null;
  const position = getSourceFromSourceMap(sourceMap, lineNumber, columnNumber - 1);
  if (
    !position?.fileName ||
    position.lineNumber === undefined ||
    position.columnNumber === undefined
  ) {
    return null;
  }
  if (!sourceMap.sourceMapUrl) return null;
  const originalSourceUrl = resolveOriginalSourceUrl(position.fileName, sourceMap.sourceMapUrl);
  if (!originalSourceUrl) return null;
  return {
    ignored: position.isIgnoreListed ?? false,
    location: [
      position.functionName ?? "",
      originalSourceUrl,
      position.lineNumber,
      position.columnNumber + 1,
    ],
  };
};
