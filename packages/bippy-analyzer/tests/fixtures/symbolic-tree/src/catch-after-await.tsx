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
