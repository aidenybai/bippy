import { useActionState } from "react";

declare const save: () => Promise<void>;

export const AsyncAction = () => {
  const [status, submit, isPending] = useActionState(async (_previous: "idle" | "saved") => {
    await save();
    return "saved" as const;
  }, "idle");
  return (
    <form action={submit}>
      <button type="submit" disabled={isPending}>
        Save
      </button>
      {status === "saved" && <p>Saved</p>}
    </form>
  );
};

export const SyncAction = () => {
  const [status, submit, isPending] = useActionState(
    (_previous: "idle" | "saved") => "saved" as const,
    "idle",
  );
  return (
    <form action={submit}>
      <button type="submit" disabled={isPending}>
        Save
      </button>
      {status === "saved" && <p>Saved</p>}
    </form>
  );
};
