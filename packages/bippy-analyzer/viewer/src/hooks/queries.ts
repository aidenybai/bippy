import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ViewFile } from "../model";

const fetchJson = async <Value>(path: string, params: Record<string, string>): Promise<Value> => {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

export const useView = (file: string | null): UseQueryResult<ViewFile> =>
  useQuery({
    queryKey: ["view", file],
    queryFn: () => fetchJson<ViewFile>("/api/analysis", { file: file ?? "" }),
    enabled: file !== null,
    staleTime: Infinity,
  });
