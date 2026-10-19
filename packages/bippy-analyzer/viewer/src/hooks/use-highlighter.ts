import { use } from "react";
import { getSharedHighlighter, type DiffsHighlighter } from "@pierre/diffs";
import type { Theme } from "./use-resolved-theme";

export const CODE_THEMES = { light: "github-light", dark: "github-dark-default" } as const;

export type CodeTheme = (typeof CODE_THEMES)[Theme];

export const getCodeTheme = (theme: Theme): CodeTheme => CODE_THEMES[theme];

const cache: { promise: Promise<DiffsHighlighter> | null } = { promise: null };

export const loadHighlighter = (): Promise<DiffsHighlighter> => {
  cache.promise ??= getSharedHighlighter({
    themes: [CODE_THEMES.light, CODE_THEMES.dark],
    langs: ["tsx", "ts", "jsx", "js", "json"],
    preferredHighlighter: "shiki-js",
  });
  return cache.promise;
};

export const useHighlighter = (): DiffsHighlighter => use(loadHighlighter());
