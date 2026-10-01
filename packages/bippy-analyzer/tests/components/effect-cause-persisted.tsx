import { useEffect, useState } from "react";

interface TriggerProps {
  onReady: () => void;
}

const Trigger = ({ onReady }: TriggerProps) => {
  useEffect(() => onReady(), [onReady]);
  return <canvas />;
};

export default () => {
  const [isReady, setReady] = useState(false);
  const [hasTicked, setTicked] = useState(false);
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  useEffect(() => {
    const timer = setTimeout(() => setTicked(true), 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main>
      {context ? <Trigger onReady={() => setReady(true)} /> : <aside />}
      {isReady ? <strong>ready</strong> : <span>waiting</span>}
      {hasTicked ? <footer>ticked</footer> : null}
    </main>
  );
};

export const isEnumerated = true;
