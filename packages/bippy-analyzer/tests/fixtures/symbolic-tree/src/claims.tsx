import { useState } from "react";
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
