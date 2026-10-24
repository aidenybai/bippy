import { useState } from "react";

type Status = "idle" | "checking";

export const DefaultsThenSpread = () => {
  const [state, setState] = useState<{ status: Status }>({ status: "idle" });
  const merged = { status: "idle" as Status, ...state };
  return (
    <div>
      <button onClick={() => setState({ status: "checking" })}>Check</button>
      {merged.status === "idle" ? <p>Idle</p> : <p>Checking</p>}
    </div>
  );
};

export const SpreadOnly = () => {
  const [state, setState] = useState<{ status: Status }>({ status: "idle" });
  const copy = { ...state, progress: 1 };
  return (
    <div>
      <button onClick={() => setState({ status: "checking" })}>Check</button>
      {copy.status === "idle" ? <p>Idle</p> : <p>Checking</p>}
    </div>
  );
};

export const SpreadThenDefault = () => {
  const [state, setState] = useState<{ status: Status }>({ status: "idle" });
  const copy = { progress: 1, ...state };
  return (
    <div>
      <button onClick={() => setState({ status: "checking" })}>Check</button>
      {copy.status === "idle" ? <p>Idle</p> : <p>Checking</p>}
      {copy.progress === 1 ? <b>Started</b> : null}
    </div>
  );
};

declare const extra: unknown;

export const UnknownSpread = () => {
  const [state, setState] = useState<{ status: Status }>({ status: "idle" });
  const merged = { status: "idle" as Status, ...(extra as object), ...state };
  const loose = { status: state.status, ...(extra as object) };
  return (
    <div>
      <button onClick={() => setState({ status: "checking" })}>Check</button>
      {merged.status === "idle" ? <p>Idle</p> : <p>Checking</p>}
      {loose.status === "idle" ? <i>Loose</i> : null}
    </div>
  );
};
