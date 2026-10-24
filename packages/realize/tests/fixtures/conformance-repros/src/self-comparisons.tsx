import { useState } from "react";

type Mode = "a" | "b";

export const SelfMode = ({ mode }: { mode: Mode }) => (
  <div>{mode === mode ? <i>same</i> : <i>different</i>}</div>
);

export const SelfField = () => {
  const [state, setState] = useState<{ mode: Mode }>({ mode: "a" });
  return (
    <div>
      <button onClick={() => setState({ mode: "b" })}>b</button>
      {state.mode !== state.mode ? <i>different</i> : <i>same</i>}
    </div>
  );
};

export const SelfCount = ({ count }: { count: number }) => (
  <div>{count === count ? <i>same</i> : <i>nan</i>}</div>
);
