import { queryOptions, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ViewFile } from "@/model";

const request = async (path: string, params: Record<string, string>): Promise<Response> => {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response;
};

export const viewQuery = (file: string) =>
  queryOptions({
    queryKey: ["view", file],
    queryFn: async (): Promise<ViewFile> => (await request("/api/analysis", { file })).json(),
    staleTime: Infinity,
  });

export const analyzerJsonQuery = (file: string) =>
  queryOptions({
    queryKey: ["analyzer-json", file],
    queryFn: async (): Promise<string> =>
      (await request("/api/analysis", { file, format: "json" })).text(),
    staleTime: Infinity,
  });

export const useView = (file: string | null): UseQueryResult<ViewFile> =>
  useQuery({ ...viewQuery(file ?? ""), enabled: file !== null });

export const useAnalyzerJson = (file: string | null): UseQueryResult<string> =>
  useQuery({ ...analyzerJsonQuery(file ?? ""), enabled: file !== null });
