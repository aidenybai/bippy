import { useState } from "react";

export const SaveButton = () => {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/save", { method: "POST" });
      setError(response.ok ? null : "failed");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed");
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <button onClick={save} disabled={isSaving}>
      {isSaving ? "saving" : (error ?? "save")}
    </button>
  );
};
