import { useEffect, useState } from "react";

const registry = new Map<string, boolean>();
let missingReads = 0;

const Trigger = () => {
  const [isReady, setReady] = useState(false);
  useEffect(() => {
    registry.set("ready", true);
    setReady(true);
    return () => {
      registry.delete("ready");
    };
  }, []);
  if (isReady && !registry.has("ready")) missingReads++;
  return isReady ? <strong>ready</strong> : <canvas />;
};

export default () => {
  const isRegistered = registry.has("ready");
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  const [hasTicked, setTicked] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTicked(true), 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main>
      {context ? <Trigger /> : <aside />}
      <p>registry: {isRegistered ? "ready" : "idle"}</p>
      <output>misses: {missingReads}</output>
      {hasTicked ? <footer>ticked</footer> : null}
    </main>
  );
};

export const isEnumerated = true;
