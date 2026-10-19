import { useState } from "react";

type Status = "idle" | "loading" | "done" | "error";

const StatusBadge = ({ status, count }: { status: Status; count: number }) => {
  if (status === "error") return <p>Failed</p>;
  if (status === "loading") return <p>Loading…</p>;
  return (
    <p>
      {status === "done" ? "Done" : "Idle"} {count}
    </p>
  );
};

export const Loader = () => {
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [count, setCount] = useState(0);
  const start = () => {
    setStatus("loading");
    setCount(count + 1);
  };
  return (
    <div>
      <StatusBadge status={status} count={count} />
      <button onClick={start}>Start</button>
      <button onClick={() => setStatus("done")}>Finish</button>
    </div>
  );
};
