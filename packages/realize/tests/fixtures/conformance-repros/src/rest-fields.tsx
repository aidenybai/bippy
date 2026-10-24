import { useState } from "react";

type Status = { kind: "idle" } | { kind: "done"; value: number };

interface Form {
  open: boolean;
  status: Status;
}

export const RestUpdater = () => {
  const [form, setForm] = useState<Form>({ open: false, status: { kind: "done", value: 1 } });
  return (
    <div>
      <button onClick={() => setForm(({ open, ...rest }) => ({ ...rest, open: !open }))}>
        flip
      </button>
      <button onClick={() => setForm({ ...form, status: { kind: "done", value: 0 } })}>zero</button>
      {form.status.kind === "done" ? form.status.value > 0 ? <i>yes</i> : <i>no</i> : <i>idle</i>}
    </div>
  );
};

export const RestHandler = () => {
  const [form, setForm] = useState<Form>({ open: false, status: { kind: "done", value: 1 } });
  return (
    <div>
      <button
        onClick={() => {
          const { open, ...rest } = form;
          setForm({ ...rest, open: !open });
        }}
      >
        flip
      </button>
      <button onClick={() => setForm({ ...form, status: { kind: "done", value: 0 } })}>zero</button>
      {form.status.kind === "done" ? form.status.value > 0 ? <i>yes</i> : <i>no</i> : <i>idle</i>}
    </div>
  );
};
