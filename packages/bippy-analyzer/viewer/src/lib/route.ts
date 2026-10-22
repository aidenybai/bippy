import { isViewMode, type ViewMode } from "./view-mode";

interface Route {
  name: string;
  mode: ViewMode;
}

interface FileRoute {
  file: string;
  mode: ViewMode;
}

export const parseRoute = (slug: string[], names: Set<string>): Route | null => {
  const [name, mode, ...rest] = slug;
  if (name === undefined || rest.length > 0 || !names.has(name)) return null;
  if (mode === undefined) return { name, mode: "code" };
  return isViewMode(mode) && mode !== "code" ? { name, mode } : null;
};

export const parseFileRoute = (segments: string[]): FileRoute | null => {
  const last = segments.at(-1);
  const mode = isViewMode(last) && last !== "code" ? last : "code";
  const fileSegments = mode === "code" ? segments : segments.slice(0, -1);
  if (fileSegments.length === 0) return null;
  return { file: fileSegments.map(decodeURIComponent).join("/"), mode };
};

export const getRouteHref = (name: string, mode: ViewMode = "code"): string =>
  mode === "code" ? `/${name}` : `/${name}/${mode}`;
