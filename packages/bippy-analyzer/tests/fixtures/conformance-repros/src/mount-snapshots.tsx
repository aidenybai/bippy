import { useState } from "react";

type Mode = "a" | "b";

export const FrozenFlag = () => {
  const [mode, setMode] = useState<Mode>("a");
  const [isB] = useState(mode === "b");
  return (
    <div>
      <button onClick={() => setMode("b")}>b</button>
      {isB ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const UpdatedFlag = () => {
  const [mode, setMode] = useState<Mode>("a");
  const [isB, setIsB] = useState(mode === "b");
  return (
    <div>
      <button onClick={() => setMode("b")}>b</button>
      <button onClick={() => setIsB(true)}>flag</button>
      {isB ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const PropSnapshot = ({ initialMode }: { initialMode: Mode }) => {
  const [isB] = useState(initialMode === "b");
  return isB ? <i>yes</i> : <i>no</i>;
};
