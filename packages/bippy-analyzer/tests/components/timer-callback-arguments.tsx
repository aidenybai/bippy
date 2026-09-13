import { useEffect, useState } from "react";

export default () => {
  const [timeoutValue, setTimeoutValue] = useState("pending");
  const [intervalValue, setIntervalValue] = useState("pending");
  useEffect(() => {
    const onTimeout = (...labels: string[]) => setTimeoutValue(labels.join("-"));
    const timeout = setTimeout(onTimeout.bind(null, "bound"), 0, "timeout", "ready");
    const interval = setInterval(
      (label: string) => {
        setIntervalValue(label);
        clearInterval(interval);
      },
      0,
      "interval-ready",
    );
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);
  return (
    <main>
      <p>timeout: {timeoutValue}</p>
      <p>interval: {intervalValue}</p>
    </main>
  );
};

export const isEnumerated = true;
