import { getSharedHighlighter, type DiffsHighlighter } from "@pierre/diffs";
import { useQuery } from "@tanstack/react-query";
import type { Theme } from "./use-theme";

export const CODE_THEMES = { light: "github-light", dark: "github-dark-default" } as const;

export type CodeTheme = (typeof CODE_THEMES)[Theme];

export const getCodeTheme = (theme: Theme): CodeTheme => CODE_THEMES[theme];

export const useHighlighter = (): DiffsHighlighter | null =>
  useQuery({
    queryKey: ["highlighter"],
    queryFn: () =>
      getSharedHighlighter({
        themes: [CODE_THEMES.light, CODE_THEMES.dark],
        langs: ["tsx", "ts", "jsx", "js"],
        preferredHighlighter: "shiki-js",
      }),
    staleTime: Infinity,
  }).data ?? null;
