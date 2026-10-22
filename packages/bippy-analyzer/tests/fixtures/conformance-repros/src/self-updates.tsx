import { useState } from "react";

export const SelfToggle = () => {
  const [isOn, setIsOn] = useState(false);
  return (
    <div>
      <button onClick={() => setIsOn(isOn)}>Same</button>
      {isOn ? <p>On</p> : <p>Off</p>}
    </div>
  );
};

export const SelfPhase = () => {
  const [phase, setPhase] = useState<"p0" | "p1" | "p2">("p0");
  return (
    <div>
      <button onClick={() => setPhase(phase === "p0" ? "p1" : phase)}>Next</button>
      {phase === "p0" ? <p>Zero</p> : phase === "p1" ? <p>One</p> : <p>Two</p>}
    </div>
  );
};
