import { isViewMode, type ViewMode } from "./view-mode";

interface Route {
  name: string | null;
  mode: ViewMode;
}

interface FileRoute {
  file: string;
  mode: ViewMode;
}

export const parseRoute = (slug: string[] | undefined, names: Set<string>): Route | null => {
  const [name, mode, ...rest] = slug ?? [];
  if (rest.length > 0) return null;
  if (name === undefined) return { name: null, mode: "code" };
  if (!names.has(name)) return null;
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

export const getRouteHref = (name: string | null, mode: ViewMode = "code"): string => {
  if (name === null) return "/";
  return mode === "code" ? `/${name}` : `/${name}/${mode}`;
};
