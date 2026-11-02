import { useActionState, useState } from "react";

const save = async (data: FormData): Promise<void> => {
  await Promise.resolve(data);
};

export const SaveForm = () => {
  const [loading, setLoading] = useState(false);
  const submit = async (data: FormData): Promise<void> => {
    setLoading(true);
    try {
      await save(data);
    } finally {
      setLoading(false);
    }
  };
  return (
    <form action={submit}>
      {loading ? <p>Saving…</p> : <button formAction={submit}>Save</button>}
    </form>
  );
};

const rename = (previous: string, data: FormData): string => {
  const next = data.get("name");
  return typeof next === "string" ? next : previous;
};

export const NameForm = () => {
  const [name, submitName, isPending] = useActionState(rename, "");
  return (
    <form action={submitName}>
      {isPending ? <p>Saving…</p> : <p>{name === "" ? "No name yet" : name}</p>}
      <button>Save</button>
    </form>
  );
};
