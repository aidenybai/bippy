import { useState } from "react";
import { match } from "ts-pattern";

type Status = "idle" | "loading" | "done";

interface User {
  name: string;
}

export const StatusView = () => {
  const [status, setStatus] = useState<Status>("idle");
  return (
    <div>
      {match(status)
        .with("idle", () => <button onClick={() => setStatus("loading")}>Start</button>)
        .with("loading", () => <button onClick={() => setStatus("done")}>Finish</button>)
        .otherwise(() => (
          <p>Done</p>
        ))}
    </div>
  );
};

export const StepView = ({ step, user }: { step: "panel" | "list"; user: User | null }) => (
  <div>
    {match({ step })
      .with({ step: "panel" }, () => <aside>panel</aside>)
      .with({ step: "list" }, () => <ul />)
      .exhaustive()}
    {match(Boolean(user))
      .with(true, () => <b>{user!.name}</b>)
      .with(false, () => <i>anonymous</i>)
      .exhaustive()}
  </div>
);
