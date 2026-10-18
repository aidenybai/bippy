import { useEffect, useState } from "react";
import type { ViewComponent } from "../model";

export type AnalysisState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; component: ViewComponent };

const getAnalysisUrl = (query: URLSearchParams): string => {
  const url = new URL("/api/analysis", window.location.origin);
  for (const key of ["tsconfig", "file", "component", "json"]) {
    const value = query.get(key);
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
};

const fetchAnalysis = async (
  query: URLSearchParams,
  signal: AbortSignal,
): Promise<ViewComponent> => {
  const response = await fetch(getAnalysisUrl(query), { signal });
  if (!response.ok) throw new Error(await response.text());
  const component: ViewComponent | null = await response.json();
  if (!component) throw new Error("Component not found");
  return component;
};

export const useAnalysis = (query: URLSearchParams): AnalysisState => {
  const [state, setState] = useState<AnalysisState>({ status: "loading" });
  const key = query.toString();
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchAnalysis(new URLSearchParams(key), controller.signal)
      .then((component) => setState({ status: "ready", component }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return () => controller.abort();
  }, [key]);
  return state;
};
