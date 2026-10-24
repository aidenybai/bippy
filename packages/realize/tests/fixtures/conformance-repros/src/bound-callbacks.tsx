import { useState } from "react";

type Mode = "a" | "b";

const Trigger = ({ onGo }: { onGo: () => void }) => <button onClick={onGo}>go</button>;

export const BoundSetter = () => {
  const [flag, setFlag] = useState(false);
  return (
    <div>
      <Trigger onGo={setFlag.bind(null, true)} />
      {flag ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const BoundHandler = () => {
  const [mode, setMode] = useState<Mode>("a");
  const pick = (next: Mode) => setMode(next);
  return (
    <div>
      <button onClick={pick.bind(null, "b")}>b</button>
      {mode === "b" ? <i>yes</i> : <i>no</i>}
    </div>
  );
};
