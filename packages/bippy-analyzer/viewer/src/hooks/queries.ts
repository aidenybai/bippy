import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getSourceKey, type Source } from "@/lib/source";
import type { Example, ViewFile } from "@/model";

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

const fetchView = (source: Source): Promise<ViewFile> =>
  source.kind === "file"
    ? fetchJson<ViewFile>("/api/analysis", { file: source.file })
    : postJson<ViewFile>("/api/paste", { code: source.code });

export const useView = (source: Source | null): UseQueryResult<ViewFile> =>
  useQuery({
    queryKey: ["view", source === null ? null : getSourceKey(source)],
    queryFn: () => fetchView(source ?? { kind: "code", code: "" }),
    enabled: source !== null,
    staleTime: Infinity,
  });

export const useExamples = (): UseQueryResult<Example[]> =>
  useQuery({
    queryKey: ["examples"],
    queryFn: () => fetchJson<Example[]>("/api/examples", {}),
    staleTime: Infinity,
  });

export const useAnalyzerJson = (file: string | null): UseQueryResult<string> =>
  useQuery({
    queryKey: ["analyzer-json", file],
    queryFn: () => fetchText("/api/analysis", { file: file ?? "", format: "json" }),
    enabled: file !== null,
    staleTime: Infinity,
  });
