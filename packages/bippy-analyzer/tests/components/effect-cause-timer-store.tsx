import { useEffect, useState } from "react";

const registry = new Map<string, boolean>();

const Trigger = () => {
  useEffect(() => {
    const timer = setTimeout(() => registry.set("ready", true), 0);
    return () => clearTimeout(timer);
  }, []);
  return <canvas />;
};

export default () => {
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  const [hasTicked, setTicked] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTicked(true), 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main>
      {context ? <Trigger /> : <aside />}
      {registry.has("ready") ? <strong /> : <span />}
      {hasTicked ? <footer /> : null}
    </main>
  );
};

export const isEnumerated = true;
