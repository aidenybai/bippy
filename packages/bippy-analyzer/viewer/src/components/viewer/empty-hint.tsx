import { useEffect } from "react";
import { useExamples } from "@/hooks/queries";
import { useViewer } from "./context";

const EXAMPLE_FOLDER = "symbolic-tree";

const Examples = () => {
  const { open } = useViewer();
  const examples = useExamples();
  const picks = examples.data?.filter((example) => example.folder === EXAMPLE_FOLDER) ?? [];
  if (picks.length === 0) return null;
  return (
    <p className="pointer-events-auto flex flex-wrap gap-x-3 text-faint">
      <span>or open</span>
      {picks.map((example) => (
        <button
          key={example.file}
          type="button"
          onClick={() => open({ kind: "file", file: example.file })}
          className="rounded-sm text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:shadow-focus"
        >
          {example.name}
        </button>
      ))}
    </p>
  );
};

const usePasteAnywhere = (): void => {
  const { open } = useViewer();
  useEffect(() => {
    const handle = (event: ClipboardEvent): void => {
      if (event.target instanceof Element && event.target.closest("diffs-container")) return;
      const code = event.clipboardData?.getData("text/plain").trim();
      if (code) open({ kind: "code", code });
    };
    document.addEventListener("paste", handle);
    return () => document.removeEventListener("paste", handle);
  }, [open]);
};

const Hint = () => (
  <div className="pointer-events-none absolute inset-x-0 top-1 grid gap-[19px] pl-16 font-mono text-[13px]/[19px]">
    <p className="text-faint">Paste or type a React component…</p>
    <Examples />
  </div>
);

export const EmptyHint = () => {
  usePasteAnywhere();
  return <Hint />;
};
