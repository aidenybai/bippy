import { useState } from "react";

export const ToneCounter = ({ tone }: { tone?: string }) => {
  const [count, setCount] = useState(0);
  return (
    <div>
      {tone === "info" ? (
        <b>{count > 0 ? "Info again" : "Info"}</b>
      ) : (
        <i>{count > 0 ? "Other again" : "Other"}</i>
      )}
      <button onClick={() => setCount(count + 1)}>{count}</button>
    </div>
  );
};
