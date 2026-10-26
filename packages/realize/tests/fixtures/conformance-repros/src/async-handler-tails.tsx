import { useState } from "react";

export const SendRequest = () => {
  const [status, setStatus] = useState<"idle" | "sending" | "failed">("idle");
  const send = async () => {
    if (status === "sending") return;
    setStatus("sending");
    await Promise.resolve();
    setStatus("failed");
  };
  return (
    <div>
      <button disabled={status === "sending"} onClick={send}>
        Send
      </button>
      {status === "sending" ? <p>Sending</p> : status === "failed" ? <p>Failed</p> : null}
    </div>
  );
};
