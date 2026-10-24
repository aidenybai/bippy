import { useState } from "react";

export const UploadQueue = ({ files }: { files: File[] }) => {
  const [status, setStatus] = useState<"idle" | "uploading" | "done">("idle");
  const upload = async () => {
    setStatus("uploading");
    for (const file of files) await fetch("/upload", { method: "POST", body: file });
    setStatus("done");
  };
  return (
    <div>
      <button onClick={upload}>Upload</button>
      {status === "uploading" && <p>Uploading</p>}
      {status === "done" && <p>Uploaded</p>}
    </div>
  );
};
