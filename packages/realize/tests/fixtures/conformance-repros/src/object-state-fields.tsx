import { useState } from "react";

export const PairState = () => {
  const [state, setState] = useState<{ isOpen: boolean; step: number }>({ isOpen: false, step: 0 });
  return (
    <div>
      <button onClick={() => setState({ isOpen: true, step: 1 })}>Open</button>
      <button onClick={() => setState({ isOpen: false, step: 0 })}>Close</button>
      {state.isOpen ? <p>Open</p> : <p>Closed</p>}
      {state.step === 1 ? <p>Step one</p> : <p>Step zero</p>}
    </div>
  );
};

type Mode = "a" | "b";

export const MovingFields = () => {
  const [state, setState] = useState<{ mode: Mode; count: number }>({ mode: "a", count: 0 });
  return (
    <div>
      <button onClick={() => setState({ mode: "b", count: 1 })}>Go</button>
      {state.mode === "b" && state.count === 0 ? <i>impossible</i> : <i>fine</i>}
    </div>
  );
};
