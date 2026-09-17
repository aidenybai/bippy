import { useEffect, useState } from "react";

let painter: string | null = null;

const Trigger = () => {
  useEffect(() => {
    painter = "canvas";
    return () => {
      painter = null;
    };
  }, []);
  return <canvas />;
};

export default () => {
  const [hasTicked, setTicked] = useState(false);
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  useEffect(() => {
    const timer = setTimeout(() => setTicked(true), 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main>
      {context ? <Trigger /> : <aside />}
      <p>painted by: {painter ?? "nobody"}</p>
      {hasTicked ? <footer>ticked</footer> : null}
    </main>
  );
};

export const isEnumerated = true;
