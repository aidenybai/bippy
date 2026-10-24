import { useEffect, useState } from "react";

export const MountOnly = () => {
  const [mode, setMode] = useState<"a" | "b">("a");
  const [phase, setPhase] = useState<"p0" | "p1">("p0");
  useEffect(() => {
    if (mode === "b") setPhase("p1");
  }, []);
  return (
    <div>
      <button onClick={() => setMode("b")}>b</button>
      {phase === "p1" ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const OnModeChange = () => {
  const [mode, setMode] = useState<"a" | "b">("a");
  const [phase, setPhase] = useState<"p0" | "p1">("p0");
  useEffect(() => {
    if (mode === "b") setPhase("p1");
  }, [mode]);
  return (
    <div>
      <button onClick={() => setMode("b")}>b</button>
      {phase === "p1" ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const MountOnlyWrite = () => {
  const [phase, setPhase] = useState<"p0" | "p1">("p0");
  useEffect(() => {
    setPhase("p1");
  }, []);
  return <div>{phase === "p1" ? <i>yes</i> : <i>no</i>}</div>;
};
