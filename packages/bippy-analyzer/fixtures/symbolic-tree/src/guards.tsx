import { useState } from "react";

export const Composer = () => {
  const [draft, setDraft] = useState("");
  const [isSent, setIsSent] = useState(false);
  const send = () => {
    if (!draft) return;
    setIsSent(true);
  };
  if (isSent) return <p>Sent</p>;
  return (
    <div>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button onClick={send}>Send</button>
    </div>
  );
};
