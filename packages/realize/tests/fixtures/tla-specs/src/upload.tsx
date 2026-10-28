import { useState } from "react";

export const Upload = () => {
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setStatus("uploading");
    setError(null);
    const response = await fetch("/upload", { method: "POST" });
    if (response.ok) {
      setStatus("done");
      return;
    }
    setStatus("failed");
    setError("Upload failed");
  };

  if (status === "done") return <button onClick={() => setStatus("idle")}>Upload another</button>;
  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <button disabled={status === "uploading"} onClick={start}>
        Upload
      </button>
    </div>
  );
};
