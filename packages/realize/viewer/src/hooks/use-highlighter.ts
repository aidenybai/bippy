import { use, useEffect } from "react";
import { getSharedHighlighter, type DiffsHighlighter } from "@pierre/diffs";
import type { Theme } from "./use-resolved-theme";

export const CODE_THEMES = { light: "github-light", dark: "github-dark-default" } as const;

export const getCodeTheme = (theme: Theme): (typeof CODE_THEMES)[Theme] => CODE_THEMES[theme];

const cache: { promise: Promise<DiffsHighlighter> | null } = { promise: null };

const loadHighlighter = (): Promise<DiffsHighlighter> => {
  cache.promise ??= getSharedHighlighter({
    themes: [CODE_THEMES.light, CODE_THEMES.dark],
    langs: ["tsx", "ts", "jsx", "js", "json"],
    preferredHighlighter: "highlights",
  });
  return cache.promise;
};

export const useHighlighter = (): DiffsHighlighter => use(loadHighlighter());

export const useHighlighterWarmup = (): void => {
  useEffect(() => {
    void loadHighlighter();
  }, []);
};
