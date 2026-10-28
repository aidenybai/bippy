import { useState } from "react";

const signOut = (): Promise<string | null> =>
  fetch("/api/sign-out").then((response) => (response.ok ? null : "Sign out failed"));

export const SignOutPanel = () => {
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("recent");
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          setError(await signOut());
        }}
      >
        Sign out
      </button>
      <button type="button" onClick={() => setTab("all")}>
        All
      </button>
      {error ? <p>{error}</p> : null}
      <span>{tab}</span>
    </div>
  );
};

const readError = async (): Promise<string | null> => {
  const response = await fetch("/api/profile");
  if (response.ok) return null;
  const body: { error?: string } = await response.json().catch(() => ({}));
  return body.error ?? "Save failed";
};

export const SaveProfilePanel = () => {
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("recent");
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          setError(await readError());
        }}
      >
        Save
      </button>
      <button type="button" onClick={() => setTab("all")}>
        All
      </button>
      {error ? <p>{error}</p> : null}
      <span>{tab}</span>
    </div>
  );
};
