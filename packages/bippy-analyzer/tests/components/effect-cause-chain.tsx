import { useEffect, useLayoutEffect, useState } from "react";

interface TriggerProps {
  onReady: () => void;
}

const Trigger = ({ onReady }: TriggerProps) => {
  useLayoutEffect(() => onReady(), [onReady]);
  return <canvas />;
};

export default () => {
  const [isReady, setReady] = useState(false);
  const [isSettled, setSettled] = useState(false);
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  useEffect(() => {
    if (isReady) setSettled(true);
  }, [isReady]);
  return (
    <main>
      {context ? <Trigger onReady={() => setReady(true)} /> : <aside />}
      {isReady ? <strong>ready</strong> : <span>waiting</span>}
      {isSettled ? <footer>settled</footer> : null}
    </main>
  );
};

export const isEnumerated = true;
