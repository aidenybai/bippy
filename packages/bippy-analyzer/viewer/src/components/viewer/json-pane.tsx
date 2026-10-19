import { Suspense, useMemo } from "react";
import { File, Virtualizer, type FileOptions } from "@pierre/diffs/react";
import { getCodeTheme, useHighlighter } from "@/hooks/use-highlighter";
import { useIsClient } from "@/hooks/use-is-client";
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

const JsonView = ({ json }: { json: string }) => {
  useHighlighter();
  const { theme } = useResolvedTheme();
  const options = useMemo<FileOptions<undefined, undefined>>(
    () => ({ ...FILE_OPTIONS, theme: getCodeTheme(theme) }),
    [theme],
  );
  const contents = useMemo(() => ({ name: "analysis.json", contents: json }), [json]);
  return (
    <Virtualizer
      className="h-full overflow-y-auto overflow-x-hidden overscroll-none [scrollbar-gutter:stable]"
      contentClassName="min-w-0 py-1 pr-4 text-[13px]/[19px]"
    >
      <File file={contents} options={options} disableWorkerPool />
    </Virtualizer>
  );
};

export const JsonPane = () => {
  const { json } = useViewer();
  const isClient = useIsClient();
  if (json === null) return null;
  const skeleton = (
    <div className="h-full overflow-hidden">
      <CodeSkeleton source={json} />
    </div>
  );
  if (!isClient) return skeleton;
  return (
    <Suspense fallback={skeleton}>
      <JsonView json={json} />
    </Suspense>
  );
};
