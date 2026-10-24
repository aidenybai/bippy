import { useState } from "react";

export const StreamedReply = ({ chunks }: { chunks: AsyncIterable<string> }) => {
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "done" | "failed">("idle");
  const stream = async () => {
    setStatus("streaming");
    try {
      for await (const chunk of chunks) setReply((previous) => previous + chunk);
      setStatus("done");
    } catch {
      setStatus("failed");
    }
  };
  if (status === "failed") return <p>The reply stopped</p>;
  return (
    <div>
      <button onClick={stream} disabled={status === "streaming"}>
        Ask
      </button>
      {status === "done" && <p>{reply}</p>}
    </div>
  );
};
