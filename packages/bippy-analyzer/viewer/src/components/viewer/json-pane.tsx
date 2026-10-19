import { Suspense, useMemo } from "react";
import { File, Virtualizer } from "@pierre/diffs/react";
import { Spinner } from "@/components/ui/spinner";
import { useFileOptions } from "@/hooks/use-file-options";
import { useHighlighter } from "@/hooks/use-highlighter";
import { useIsClient } from "@/hooks/use-is-client";
import { useViewer } from "./context";

const JsonView = ({ json }: { json: string }) => {
  useHighlighter();
  const options = useFileOptions();
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
  const spinner = <Spinner className="h-full" />;
  if (!isClient) return spinner;
  return (
    <Suspense fallback={spinner}>
      <JsonView json={json} />
    </Suspense>
  );
};
