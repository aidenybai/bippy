import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { SourceLocation } from "../types";
import { getLocationKey } from "../shared/get-location-key";

export interface LabelSource {
  text: string;
  declaredNames: ReadonlyMap<string, string | null>;
}

export interface SourceReader {
  readFunction(file: string, loc: SourceLocation): string | null;
  getDeclaredName(file: string, loc: SourceLocation): string | null;
}

export const createSourceReader = (sources: ReadonlyMap<string, LabelSource>): SourceReader => ({
  readFunction: (file, loc) => {
    const source = sources.get(file);
    if (!source || loc === GeneratedSource || !source.declaredNames.has(getLocationKey(loc)))
      return null;
    return source.text.slice(loc.start.index, loc.end.index).replace(/\s+/g, " ");
  },
  getDeclaredName: (file, loc) => sources.get(file)?.declaredNames.get(getLocationKey(loc)) ?? null,
});
