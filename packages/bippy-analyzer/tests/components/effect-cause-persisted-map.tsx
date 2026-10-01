import { useEffect, useState } from "react";

const selection = new Map<string, string>();

const Trigger = () => {
  useEffect(() => {
    selection.set("ready", "canvas");
    return () => {
      selection.delete("ready");
    };
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
      <p>selection: {selection.get("ready") ?? "idle"}</p>
      {selection.has("ready") ? <strong>ready</strong> : <span>idle</span>}
      <output>size: {selection.size}</output>
      <ul>
        {Array.from(selection.values()).map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      {hasTicked ? <footer>ticked</footer> : null}
    </main>
  );
};

export const isEnumerated = true;
