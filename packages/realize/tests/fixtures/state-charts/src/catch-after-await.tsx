import { useState } from "react";

const save = async (): Promise<void> => {
  await Promise.resolve();
};

export const RetryForm = () => {
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try {
      setError(null);
      await save();
    } catch {
      setError("Failed");
    }
  };
  return (
    <form action={submit}>
      <button type="submit">Save</button>
      {error ? <p>{error}</p> : null}
    </form>
  );
};

export const UploadForm = () => {
  const [step, setStep] = useState<"idle" | "uploading" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const upload = async () => {
    try {
      setStep("uploading");
      await save();
      setStep("processing");
      await save();
      setStep("done");
    } catch {
      setError("Failed");
    }
  };
  return (
    <div>
      <button onClick={upload}>Upload</button>
      <p>{step}</p>
      {error ? <p>{error}</p> : null}
    </div>
  );
};
