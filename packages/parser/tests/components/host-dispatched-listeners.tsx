import { useEffect, useState } from "react";

// A listener the host may dispatch any number of times before the capture:
// when a second dispatch leaves every value it touches equivalent to the first,
// the state space has exactly two members (never fired, fired), the untouched
// one preferred. A second dispatch that keeps moving state (a counter) escapes
// instead, so only the keys it writes become unknown.
const Banner = () => {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    const onOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener("offline", onOffline);
    return () => window.removeEventListener("offline", onOffline);
  }, []);
  return isOnline ? <b>online</b> : <i>offline</i>;
};

const Frame = () => {
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent<{ width: number; height: number }>) => {
      setFrame({ width: event.data.width, height: event.data.height });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return frame === null ? <em>no frame</em> : <output>{frame.width}</output>;
};

const Counter = () => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const onMessage = () => {
      setCount((current) => current + 1);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  if (count === 0) return <u>none</u>;
  return count === 1 ? <s>one</s> : <strong>many</strong>;
};

const ResourceErrors = () => {
  const [hasFailure, setHasFailure] = useState(false);
  useEffect(() => {
    const onResourceError = () => {
      setHasFailure(true);
    };
    window.addEventListener("error", onResourceError, true);
    return () => window.removeEventListener("error", onResourceError, true);
  }, []);
  return hasFailure ? <mark>failed</mark> : <small>loaded</small>;
};

export default function HostDispatchedListeners() {
  return (
    <div>
      <Banner />
      <Frame />
      <Counter />
      <ResourceErrors />
    </div>
  );
}

export const isPartial = true;
export const minCoverage = 0.8;
