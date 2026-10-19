import { useMemo } from "react";
import { File, Virtualizer, type FileOptions } from "@pierre/diffs/react";
import { useAnalyzerJson } from "@/hooks/queries";
import { getCodeTheme, useHighlighter } from "@/hooks/use-highlighter";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import { useViewer } from "./context";
import { CodeSkeleton } from "./skeletons";

const FILE_OPTIONS: Omit<FileOptions<undefined, undefined>, "theme"> = {
  overflow: "wrap",
  unsafeCSS:
    ":host { background-color: transparent; --diffs-bg: transparent; } [data-gutter], [data-column-number] { background: transparent; }",
  disableFileHeader: true,
  disableErrorHandling: true,
  preferredHighlighter: "shiki-js",
};

export const JsonPane = () => {
  const { view } = useViewer();
  const json = useAnalyzerJson(view?.file ?? null);
  const isHighlighterReady = useHighlighter() !== null;
  const { theme } = useResolvedTheme();
  const options = useMemo<FileOptions<undefined, undefined>>(
    () => ({ ...FILE_OPTIONS, theme: getCodeTheme(theme) }),
    [theme],
  );
  const contents = useMemo(
    () => ({ name: "analysis.json", contents: json.data ?? "" }),
    [json.data],
  );
  if (json.error)
    return (
      <pre className="h-full overflow-auto px-4 py-4 font-mono whitespace-pre-wrap text-destructive sm:px-5">
        {json.error.message}
      </pre>
    );
  if (!isHighlighterReady || json.data === undefined) return <CodeSkeleton />;
  return (
    <Virtualizer
      className="h-full overflow-y-auto overflow-x-hidden overscroll-none [scrollbar-gutter:stable]"
      contentClassName="min-w-0 py-1 pr-4 text-[13px]/[19px]"
    >
      <File file={contents} options={options} disableWorkerPool />
    </Virtualizer>
  );
};
