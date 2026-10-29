import { useState } from "react";

export function RetryNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const retry = async () => {
    try {
      await fetch("/api/retry");
      setNotice(null);
    } catch (error) {
      requestAnimationFrame(() =>
        setNotice(error instanceof Error ? error.message : "Retry failed"),
      );
    }
  };
  return <button onClick={retry}>{notice ?? "Retry"}</button>;
}
