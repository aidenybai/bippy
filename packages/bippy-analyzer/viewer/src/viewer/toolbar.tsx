import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useViewer, type ViewMode } from "./context";
import { ThemeToggle } from "./theme-toggle";

const isViewMode = (value: unknown): value is ViewMode => value === "code" || value === "json";

const ModeTabs = () => {
  const { mode, setMode } = useViewer();
  return (
    <Tabs value={mode} onValueChange={(value) => isViewMode(value) && setMode(value)}>
      <TabsList aria-label="View">
        <TabsTrigger value="code">Code</TabsTrigger>
        <TabsTrigger value="json">JSON</TabsTrigger>
      </TabsList>
    </Tabs>
  );
};

export const Toolbar = () => {
  const { file, openFile } = useViewer();
  const [draft, setDraft] = useState(file ?? "");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const path = draft.trim();
    if (path) openFile(path);
  };
  return (
    <form onSubmit={submit} className="flex h-11 items-center gap-2 border-b px-3 sm:gap-3">
      <span className="hidden text-muted-foreground sm:inline">File</span>
      <Input
        id="file-path"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label="Path to a component file"
        placeholder="Path to a component file, then Enter"
        spellCheck={false}
        className="flex-1 font-mono"
      />
      <ModeTabs />
      <ThemeToggle />
    </form>
  );
};
