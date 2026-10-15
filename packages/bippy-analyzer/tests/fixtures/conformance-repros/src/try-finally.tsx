import { useState } from "react";

export const DownloadButton = () => {
  const [isBusy, setIsBusy] = useState(false);
  const download = async () => {
    setIsBusy(true);
    try {
      await fetch("/api/download");
    } finally {
      setIsBusy(false);
    }
  };
  return (
    <button onClick={download} disabled={isBusy}>
      {isBusy ? "downloading" : "download"}
    </button>
  );
};

export const UploadButton = () => {
  const [isBusy, setIsBusy] = useState(false);
  const [count, setCount] = useState(0);
  const upload = async () => {
    setIsBusy(true);
    try {
      const response = await fetch("/api/upload", { method: "POST" });
      if (!response.ok) return;
      setCount((current) => current + 1);
    } catch {
      return;
    } finally {
      setIsBusy(false);
    }
  };
  return (
    <button onClick={upload} disabled={isBusy}>
      {isBusy ? "uploading" : count}
    </button>
  );
};

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
