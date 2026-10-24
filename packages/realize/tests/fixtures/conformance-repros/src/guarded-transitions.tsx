import { useState } from "react";

type Phase = "p0" | "p1" | "p2";

export const GuardIgnored = () => {
  const [phase, setPhase] = useState<Phase>("p0");
  return (
    <div>
      <button onClick={() => setPhase("p2")}>finish</button>
      <button
        onClick={() => {
          if (phase === "p0") setPhase("p1");
        }}
      >
        next
      </button>
      {phase === "p0" ? <i>start</i> : phase === "p1" ? <i>middle</i> : <i>end</i>}
    </div>
  );
};

export const NeverTrueGuard = () => {
  const [phase, setPhase] = useState<Phase>("p0");
  return (
    <div>
      <button
        onClick={() => {
          if (phase === "p2") setPhase("p1");
        }}
      >
        next
      </button>
      {phase === "p0" ? <i>start</i> : phase === "p1" ? <i>middle</i> : <i>end</i>}
    </div>
  );
};

export const EarlyReturnGuard = () => {
  const [phase, setPhase] = useState<Phase>("p0");
  return (
    <div>
      <button onClick={() => setPhase("p2")}>finish</button>
      <button
        onClick={() => {
          if (phase !== "p2") return;
          setPhase("p1");
        }}
      >
        back
      </button>
      {phase === "p0" ? <i>start</i> : phase === "p1" ? <i>middle</i> : <i>end</i>}
    </div>
  );
};
