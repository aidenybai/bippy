import { useMemo } from "react";
import type { FileOptions } from "@pierre/diffs/react";
import { getCodeTheme } from "./use-highlighter";
import { useResolvedTheme } from "./use-resolved-theme";

export type CodeFileOptions = FileOptions<undefined, undefined>;

const FILE_OPTIONS: Omit<CodeFileOptions, "theme"> = {
  overflow: "wrap",
  unsafeCSS:
    ":host { background-color: transparent; --diffs-bg: transparent; } [data-gutter], [data-column-number] { background: transparent; }",
  disableFileHeader: true,
  disableErrorHandling: true,
  preferredHighlighter: "shiki-js",
};

export const useFileOptions = (onPostRender?: () => void): CodeFileOptions => {
  const { theme } = useResolvedTheme();
  return useMemo(
    () => ({ ...FILE_OPTIONS, theme: getCodeTheme(theme), onPostRender }),
    [theme, onPostRender],
  );
};
