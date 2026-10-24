import { useState } from "react";

export const LostLet = () => {
  const [count, setCount] = useState(0);
  const [note, setNote] = useState("");
  let pending: string | null = null;
  return (
    <div>
      <button
        onClick={() => {
          pending = "x";
          setCount(count + 1);
        }}
      >
        arm
      </button>
      <button onClick={() => setNote(pending === null ? "lost" : "kept")}>read</button>
      {note === "lost" ? <i>L1</i> : note === "kept" ? <i>L2</i> : null}
    </div>
  );
};

export const LostField = () => {
  const [count, setCount] = useState(0);
  const [note, setNote] = useState("");
  const box: { pending: string | null } = { pending: null };
  return (
    <div>
      <button
        onClick={() => {
          box.pending = "x";
          setCount(count + 1);
        }}
      >
        arm
      </button>
      <button onClick={() => setNote(box.pending === null ? "lost" : "kept")}>read</button>
      {note === "lost" ? <i>L1</i> : note === "kept" ? <i>L2</i> : null}
    </div>
  );
};

export const SameHandler = () => {
  const [note, setNote] = useState("");
  let pending: string | null = null;
  return (
    <div>
      <button
        onClick={() => {
          pending = "x";
          setNote(pending === null ? "lost" : "kept");
        }}
      >
        arm
      </button>
      {note === "kept" ? <i>L2</i> : null}
    </div>
  );
};

export const ReaderBeforeWriter = () => {
  const [note, setNote] = useState("");
  let pending: string | null = null;
  return (
    <div>
      <button onClick={() => setNote(pending === null ? "lost" : "kept")}>read</button>
      <button
        onClick={() => {
          pending = "x";
        }}
      >
        arm
      </button>
      {note === "lost" ? <i>lost</i> : note === "kept" ? <i>kept</i> : <i>empty</i>}
    </div>
  );
};
