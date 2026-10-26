import { useState } from "react";
import { bumpTotal, queue, session, total } from "./imported-store";

export const ImportedQueue = () => {
  const [other, setOther] = useState(0);
  return (
    <button
      onClick={() => {
        queue.push(1);
        setOther(other + 1);
      }}
    >
      {queue.length === 0 ? "empty" : "queued"}
    </button>
  );
};

export const ImportedTotal = () => {
  const [other, setOther] = useState(0);
  return (
    <button
      onClick={() => {
        bumpTotal();
        setOther(other + 1);
      }}
    >
      {total === 0 ? "none" : "some"}
    </button>
  );
};

export const ImportedSession = () => {
  const [other, setOther] = useState(0);
  return (
    <button
      onClick={() => {
        session.visits += 1;
        setOther(other + 1);
      }}
    >
      {session.visits === 0 ? "new" : "returning"}
    </button>
  );
};
