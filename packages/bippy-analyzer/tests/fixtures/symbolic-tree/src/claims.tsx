import { useEffect, useState, type ReactNode } from "react";
import invariant from "invariant";

interface User {
  name: string;
}

type Status = "idle" | "saving";

export const Profile = ({ user, mode }: { user: User | null; mode: "view" | "edit" }) => {
  const [status, setStatus] = useState<Status>("idle");
  const [step, setStep] = useState<"a" | "b" | "c">("a");
  invariant(mode === "view" || user !== null, "editing needs a user");
  if (status === "saving") return <p>Saving {(user as User).name}</p>;
  return (
    <div>
      <p>{step as "a" | "b"}</p>
      <button onClick={() => setStatus(user!.name ? "saving" : "idle")}>Save</button>
      <button onClick={() => setStep("b")}>Next</button>
      <button onClick={() => setStatus("done" as Status)}>Finish</button>
    </div>
  );
};

export const GuardedCast = ({ next }: { next: string | null }) => {
  const [status, setStatus] = useState<Status>("idle");
  const apply = () => {
    if (!next) return;
    setStatus(next as Status);
  };
  return <button onClick={apply}>{status}</button>;
};

export const HiddenHandler = ({ kind }: { kind: "a" | "b" | "c" }) => {
  const [picked, setPicked] = useState<"a" | "b">("a");
  if (kind === "c") return <p>c</p>;
  return <button onClick={() => setPicked(kind as "a" | "b")}>{picked}</button>;
};

export const GuardedWrite = ({ next }: { next: Status | undefined }) => {
  const [status, setStatus] = useState<Status>("idle");
  const apply = () => {
    if (next) setStatus(next);
  };
  return <button onClick={apply}>{status}</button>;
};

declare const whenTrue: (flag: boolean, run: () => ReactNode) => ReactNode;

export const Coalesced = ({ flags }: { flags: { ok: boolean }[] | undefined }) => {
  const serverChecked = flags?.some((flag) => flag.ok) ?? false;
  const [checked, setChecked] = useState(serverChecked);
  useEffect(() => {
    setChecked(serverChecked);
  }, [serverChecked]);
  return <p>{checked ? "on" : "off"}</p>;
};

export const EmptyObjectCast = ({ raw }: { raw: {} | undefined }) => <p>{raw as "a" | "b"}</p>;

export const OpaqueCallback = ({ user }: { user: User | null }) => (
  <div>
    {user?.name && <i>named</i>}
    {whenTrue(Boolean(user?.name), () => (
      <b>{user!.name}</b>
    ))}
  </div>
);
