import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { FileInfo, ViewComponent } from "../model";

const fetchJson = async <Value>(path: string, params: Record<string, string>): Promise<Value> => {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

export const useFileInfo = (file: string | null): UseQueryResult<FileInfo> =>
  useQuery({
    queryKey: ["file", file],
    queryFn: () => fetchJson<FileInfo>("/api/file", { file: file ?? "" }),
    enabled: file !== null,
    staleTime: Infinity,
  });

export interface ViewKey {
  file: string;
  component: string;
}

export const useView = (key: ViewKey | null): UseQueryResult<ViewComponent> =>
  useQuery({
    queryKey: ["view", key],
    queryFn: async () => {
      const view = await fetchJson<ViewComponent | null>("/api/analysis", { ...key });
      if (!view) throw new Error(`${key?.component} is not in ${key?.file}`);
      return view;
    },
    enabled: key !== null,
    staleTime: Infinity,
  });
