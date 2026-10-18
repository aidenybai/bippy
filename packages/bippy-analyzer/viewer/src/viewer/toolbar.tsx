import { useState, type FormEvent } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFileInfo } from "../hooks/queries";
import { useViewer } from "./context";

const FileInput = () => {
  const { selection, select } = useViewer();
  const [draft, setDraft] = useState(selection.file ?? "");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const file = draft.trim();
    if (file) select({ file, component: null });
  };
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2">
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

const ComponentTabs = () => {
  const { selection, select } = useViewer();
  const info = useFileInfo(selection.file);
  const components = info.data?.components ?? [];
  if (components.length < 2) return null;
  const value =
    selection.component ??
    [...components].sort((a, b) => b.stateCount - a.stateCount)[0]?.name ??
    "";
  return (
    <Tabs value={value} onValueChange={(component) => select({ component })}>
      <TabsList>
        {components.map((component) => (
          <TabsTrigger key={component.name} value={component.name}>
            {component.name}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
};

export const Toolbar = () => (
  <div className="flex h-11 items-center gap-3 border-b px-3 text-xs">
    <FileInput />
    <ComponentTabs />
  </div>
);
