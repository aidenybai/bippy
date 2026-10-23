import { useState } from "react";

export const TrimmedText = () => {
  const [text, setText] = useState("");
  return (
    <div>
      <button onClick={() => setText(text.trim())}>trim</button>
      <button onClick={() => setText(text.toUpperCase() + "")}>upper</button>
      <button onClick={() => setText(text === "" ? "ab" : "")}>swap</button>
      {text.length === 0 ? <i>empty</i> : text.length === 2 ? <i>two</i> : <i>other</i>}
    </div>
  );
};
