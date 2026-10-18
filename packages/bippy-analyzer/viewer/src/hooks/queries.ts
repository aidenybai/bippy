import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { ViewFile } from "../model";

const request = async (path: string, params: Record<string, string>): Promise<Response> => {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response;
};

const fetchJson = async <Value>(path: string, params: Record<string, string>): Promise<Value> =>
  (await request(path, params)).json();

const fetchText = async (path: string, params: Record<string, string>): Promise<string> =>
  (await request(path, params)).text();

const postJson = async <Value>(path: string, body: unknown): Promise<Value> => {
  const response = await fetch(new URL(path, window.location.origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

interface SaveInput {
  file: string;
  source: string;
}

export const useSaveFile = (): UseMutationResult<ViewFile, Error, SaveInput> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveInput) => postJson<ViewFile>("/api/file", input),
    onSuccess: (view, { file }) => {
      queryClient.setQueryData(["view", file], view);
      queryClient.invalidateQueries({ queryKey: ["analyzer-json", file] });
    },
  });
};

export const useAnalyzerJson = (file: string | null): UseQueryResult<string> =>
  useQuery({
    queryKey: ["analyzer-json", file],
    queryFn: () => fetchText("/api/analysis", { file: file ?? "", format: "json" }),
    enabled: file !== null,
    staleTime: Infinity,
  });

export const useView = (file: string | null): UseQueryResult<ViewFile> =>
  useQuery({
    queryKey: ["view", file],
    queryFn: () => fetchJson<ViewFile>("/api/analysis", { file: file ?? "" }),
    enabled: file !== null,
    staleTime: Infinity,
  });
