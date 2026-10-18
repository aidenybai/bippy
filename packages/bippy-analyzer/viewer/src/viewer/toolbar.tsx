import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "./theme-toggle";
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
    <form onSubmit={submit} className="flex h-11 items-center gap-3 border-b px-3">
      <span className="text-muted-foreground">File</span>
      <Input
        id="file-path"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label="Path to a component file"
        placeholder="Path to a component file, then Enter"
        spellCheck={false}
        className="flex-1 font-mono"
      />
      <ThemeToggle />
    </form>
  );
};
