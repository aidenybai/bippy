import { File, Virtualizer } from "@pierre/diffs/react";
import { ClientSuspense } from "@/components/ui/client-suspense";
import { useFileOptions } from "@/hooks/use-file-options";
import { useHighlighter } from "@/hooks/use-highlighter";
import { useViewer } from "./context";

const JsonView = ({ json }: { json: string }) => {
  useHighlighter();
  const options = useFileOptions();
  return (
    <Virtualizer className="scroll-pane" contentClassName="min-w-0 py-1 pr-4 text-[13px]/[19px]">
      <File file={{ name: "analysis.json", contents: json }} options={options} disableWorkerPool />
    </Virtualizer>
  );
};

export const JsonPane = () => {
  const { json } = useViewer();
  return (
    <ClientSuspense>
      <JsonView json={json} />
    </ClientSuspense>
  );
};
