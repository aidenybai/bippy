import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useSaveFile } from "../hooks/queries";
import { useEditorStore, useHasDraft } from "../store/editor";
import { useViewer } from "./context";

const useSaveDraft = (): (() => void) => {
  const { file } = useViewer();
  const save = useSaveFile();
  const settle = useEditorStore((state) => state.settle);
  return () => {
    const { draft } = useEditorStore.getState();
    if (file === null || draft === null || save.isPending) return;
    save.mutate({ file, source: draft }, { onSuccess: settle });
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

const DraftControls = () => {
  const discard = useEditorStore((state) => state.discard);
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
      <Button variant="ghost" onClick={discard} disabled={save.isPending}>
        Discard
      </Button>
      <Button onClick={saveDraft} disabled={save.isPending}>
        {save.isPending ? <Spinner className="size-3.5" /> : null}
        Save
      </Button>
    </>
  );
};

export const EditControls = () => {
  const hasDraft = useHasDraft();
  return hasDraft ? <DraftControls /> : null;
};
