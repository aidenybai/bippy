import { useState } from "react";

export const OneField = () => {
  const [votes, setVotes] = useState({ b: 0 });
  return (
    <div>
      <button onClick={() => setVotes({ b: 0 })}>vote</button>
      {votes.b > 0 ? <i>impossible</i> : <i>fine</i>}
    </div>
  );
};

export const StrTwo = () => {
  const [label, setLabel] = useState("a");
  return (
    <div>
      <button onClick={() => setLabel(label === "a" ? "bb" : "a")}>vote</button>
      {label.length > 2 ? <i>impossible</i> : <i>fine</i>}
    </div>
  );
};

export const LengthAndIncludes = () => {
  const [text, setText] = useState("");
  return (
    <div>
      <button onClick={() => setText(text === "" ? "ab" : "")}>toggle</button>
      {text.length === 0 ? <i>empty</i> : <i>full</i>}
      {text.includes("a") ? <b>a</b> : <b>no a</b>}
    </div>
  );
};
