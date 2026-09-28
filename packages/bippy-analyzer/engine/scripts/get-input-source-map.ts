import type { FileResult, InputOptions } from "@babel/core";
import { EngineBuildError } from "../errors.js";

const getString = (value: string | null): string => {
  if (value === null) throw new EngineBuildError("Engine source map contains an unresolved source");
  return value;
};

export const getInputSourceMap = (
  map: NonNullable<FileResult["map"]>,
  filename: string,
): InputOptions["inputSourceMap"] => ({
  version: map.version,
  file: map.file ?? filename,
  mappings: map.mappings,
  names: [...map.names],
  sources: map.sources.map(getString),
  sourcesContent: map.sourcesContent?.map(getString),
  sourceRoot: map.sourceRoot,
});
