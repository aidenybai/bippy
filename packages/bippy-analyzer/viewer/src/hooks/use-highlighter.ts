import { getSharedHighlighter, type DiffsHighlighter } from "@pierre/diffs";
import { useQuery } from "@tanstack/react-query";

export const CODE_THEME = "github-light";

export const useHighlighter = (): DiffsHighlighter | null =>
  useQuery({
    queryKey: ["highlighter", CODE_THEME],
    queryFn: () =>
      getSharedHighlighter({
        themes: [CODE_THEME],
        langs: ["tsx", "ts", "jsx", "js"],
        preferredHighlighter: "shiki-js",
      }),
    staleTime: Infinity,
  }).data ?? null;
