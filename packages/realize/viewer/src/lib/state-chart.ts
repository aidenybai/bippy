import type { ViewFile } from "@/model";

export const getSourceLine = (view: ViewFile, line: number): string =>
  view.source.split("\n")[line - 1]?.trim() ?? "";
