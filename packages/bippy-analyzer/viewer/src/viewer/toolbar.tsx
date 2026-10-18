import { useState, type FormEvent } from "react";
import { useViewer } from "./context";

export const Toolbar = () => {
  const { file, openFile } = useViewer();
  const [draft, setDraft] = useState(file ?? "");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const path = draft.trim();
    if (path) openFile(path);
  };
  return (
    <form onSubmit={submit} className="flex h-11 items-center border-b px-3">
      <input
        id="file-path"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label="Path to a component file"
        placeholder="Path to a component file, then Enter"
        spellCheck={false}
        className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
    </form>
  );
};
