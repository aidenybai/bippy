import { useSearchParams } from "next/navigation";
import { isViewMode, type ViewMode } from "./view-mode";

export interface Location {
  file: string | null;
  mode: ViewMode;
}

export const getFileTitle = (file: string): string => file.split("/").at(-1) ?? file;

export const useLocation = (): Location => {
  const params = useSearchParams();
  const mode = params.get("view");
  return { file: params.get("file"), mode: isViewMode(mode) ? mode : "code" };
};

export const writeLocation = ({ file, mode }: Location): void => {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (file !== null) url.searchParams.set("file", file);
  if (mode !== "code") url.searchParams.set("view", mode);
  window.history.replaceState(null, "", url.toString());
};
