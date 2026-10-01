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
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  return (
    <main>
      {context ? <Trigger onReady={() => setReady(true)} /> : <aside />}
      {isReady ? <strong>ready</strong> : <span>waiting</span>}
    </main>
  );
};

export const isEnumerated = true;
