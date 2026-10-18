import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isViewMode } from "../lib/view-mode";
import { useViewer } from "./context";
import { ThemeToggle } from "./theme-toggle";

const ModeTabs = () => {
  const { mode, setMode } = useViewer();
  return (
    <Tabs value={mode} onValueChange={(value) => isViewMode(value) && setMode(value)}>
      <TabsList aria-label="View">
        <TabsTrigger value="code">Code</TabsTrigger>
        <TabsTrigger value="diagram">Diagram</TabsTrigger>
        <TabsTrigger value="json">JSON</TabsTrigger>
      </TabsList>
    </Tabs>
  );
};

const FileInput = ({ file }: { file: string | null }) => {
  const { openFile } = useViewer();
  const [draft, setDraft] = useState(file ?? "");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const path = draft.trim();
    if (path) openFile(path);
  };
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
      <span className="hidden text-muted-foreground sm:inline">File</span>
      <Input
        id="file-path"
        name="file"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label="Path to a component file"
        placeholder="/path/to/Component.tsx…"
        autoComplete="off"
        spellCheck={false}
        className="flex-1 font-mono"
      />
    </form>
  );
};

export const Toolbar = () => {
  const { file, mode } = useViewer();
  return (
    <div className="flex h-11 items-center gap-2 border-b px-3 sm:gap-3">
      <FileInput key={file ?? ""} file={file} />
      {file !== null && (
        <>
          <ModeTabs />
          <SidebarTrigger disabled={mode === "json"} />
        </>
      )}
      <ThemeToggle />
    </div>
  );
};
