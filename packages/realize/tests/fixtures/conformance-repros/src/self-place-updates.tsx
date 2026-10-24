import { useState } from "react";

export const OrDefault = () => {
  const [text, setText] = useState("");
  return (
    <div>
      <button onClick={() => setText(text || "b")}>go</button>
      {text === "b" ? <i>L2</i> : text === "" ? <i>L1</i> : <i>Z1</i>}
    </div>
  );
};

export const OrAssign = () => {
  const [text, setText] = useState("");
  return (
    <div>
      <button
        onClick={() => {
          let next = text;
          next ||= "b";
          setText(next);
        }}
      >
        go
      </button>
      {text === "b" ? <i>L2</i> : text === "" ? <i>L1</i> : <i>Z1</i>}
    </div>
  );
};

export const SelfField = () => {
  const [box, setBox] = useState({ mode: "a", n: 0 });
  return (
    <div>
      <button onClick={() => setBox({ n: box.n, mode: "b" })}>go</button>
      {box.mode === "b" ? <i>L2</i> : <i>L1</i>}
      {box.n !== 0 && <i>Z1</i>}
    </div>
  );
};
