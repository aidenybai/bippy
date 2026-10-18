import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { isViewMode, type ViewMode } from "./view-mode";

export type Source = { kind: "file"; file: string } | { kind: "code"; code: string };

export interface Location {
  source: Source | null;
  mode: ViewMode;
}

export const getSourceKey = (source: Source): string =>
  source.kind === "file" ? `file:${source.file}` : `code:${source.code}`;

export const getSourceTitle = (source: Source): string =>
  source.kind === "file" ? (source.file.split("/").at(-1) ?? source.file) : "Pasted code";

const readSource = (query: URLSearchParams, hash: string): Source | null => {
  const file = query.get("file");
  if (file) return { kind: "file", file };
  const code = new URLSearchParams(hash.slice(1)).get("code");
  const decoded = code ? decompressFromEncodedURIComponent(code) : null;
  return decoded ? { kind: "code", code: decoded } : null;
};

export const readLocation = (): Location => {
  const query = new URLSearchParams(window.location.search);
  const mode = query.get("view");
  return {
    source: readSource(query, window.location.hash),
    mode: isViewMode(mode) ? mode : "code",
  };
};

export const writeLocation = ({ source, mode }: Location): void => {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (source?.kind === "file") url.searchParams.set("file", source.file);
  if (mode !== "code") url.searchParams.set("view", mode);
  if (source?.kind === "code") url.hash = `code=${compressToEncodedURIComponent(source.code)}`;
  window.history.replaceState(null, "", url);
};
