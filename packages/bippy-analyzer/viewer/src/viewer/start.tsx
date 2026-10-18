import { useEffect, useState, type DragEvent } from "react";
import { useExamples } from "../hooks/queries";
import { useViewer } from "./context";

const EXAMPLE_FOLDER = "symbolic-tree";

const usePasteAnywhere = (onCode: (code: string) => void): void => {
  useEffect(() => {
    const handle = (event: ClipboardEvent): void => {
      const code = event.clipboardData?.getData("text/plain").trim();
      if (code) onCode(code);
    };
    document.addEventListener("paste", handle);
    return () => document.removeEventListener("paste", handle);
  }, [onCode]);
};

const readDroppedFile = async (event: DragEvent): Promise<string | null> => {
  const file = event.dataTransfer.files[0];
  return file ? (await file.text()).trim() || null : null;
};

const Examples = () => {
  const { open } = useViewer();
  const examples = useExamples();
  const picks = examples.data?.filter((example) => example.folder === EXAMPLE_FOLDER) ?? [];
  if (picks.length === 0) return null;
  return (
    <p className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-muted-foreground">
      <span>or try</span>
      {picks.map((example) => (
        <button
          key={example.file}
          type="button"
          onClick={() => open({ kind: "file", file: example.file })}
          className="rounded-sm text-text-2 outline-none hover:text-foreground hover:underline focus-visible:shadow-focus"
        >
          {example.name}
        </button>
      ))}
    </p>
  );
};

export const Start = () => {
  const { open } = useViewer();
  const [isDragging, setDragging] = useState(false);
  const openCode = (code: string): void => open({ kind: "code", code });
  usePasteAnywhere(openCode);
  return (
    <div
      className="grid h-full place-items-center overflow-y-auto overscroll-none p-6 [scrollbar-gutter:stable]"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (event) => {
        event.preventDefault();
        setDragging(false);
        const code = await readDroppedFile(event);
        if (code) openCode(code);
      }}
    >
      <div className="grid max-w-md gap-4 text-center">
        <div
          data-dragging={isDragging || undefined}
          className="rounded-lg border border-dashed px-8 py-10 text-text-2 transition-colors duration-150 data-dragging:border-foreground data-dragging:bg-muted"
        >
          Paste a React component with <kbd className="rounded-sm bg-muted px-1">⌘V</kbd>, or drop a{" "}
          <code>.tsx</code> file here.
        </div>
        <Examples />
      </div>
    </div>
  );
};
