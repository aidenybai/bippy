import { useEffect } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useSaveFile } from "../hooks/queries";
import { useEditorStore, useHasDraft, useIsEditing } from "../store/editor";
import { useViewer } from "./context";

const useSaveDraft = (): (() => void) => {
  const { file } = useViewer();
  const save = useSaveFile();
  const stopEditing = useEditorStore((state) => state.stopEditing);
  return () => {
    const { draft } = useEditorStore.getState();
    if (file === null || draft === null || save.isPending) return;
    save.mutate({ file, source: draft }, { onSuccess: stopEditing });
  };
};

const SaveShortcut = ({ onSave }: { onSave: () => void }) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSave]);
  return null;
};

const EditingControls = () => {
  const stopEditing = useEditorStore((state) => state.stopEditing);
  const hasDraft = useHasDraft();
  const save = useSaveFile();
  const saveDraft = useSaveDraft();
  return (
    <>
      <SaveShortcut onSave={saveDraft} />
      {save.error && (
        <span className="truncate text-destructive" role="alert">
          {save.error.message.split("\n")[0]}
        </span>
      )}
      <Button variant="ghost" onClick={stopEditing} disabled={save.isPending}>
        Cancel
      </Button>
      <Button onClick={saveDraft} disabled={!hasDraft || save.isPending}>
        {save.isPending ? <Spinner className="size-3.5" /> : null}
        Save
      </Button>
    </>
  );
};

export const EditControls = () => {
  const { file, view, mode } = useViewer();
  const isEditing = useIsEditing();
  const startEditing = useEditorStore((state) => state.startEditing);
  if (file === null || view === null || mode !== "code") return null;
  if (isEditing) return <EditingControls />;
  return (
    <Button variant="ghost" size="icon" onClick={startEditing} aria-label="Edit code" title="Edit">
      <Pencil />
    </Button>
  );
};
