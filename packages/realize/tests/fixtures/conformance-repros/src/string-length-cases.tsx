import { useState } from "react";

export const AppendText = () => {
  const [text, setText] = useState("");
  return (
    <div>
      {text.length > 1 ? <i>long</i> : <i>short</i>}
      {text === "" ? <i>empty</i> : <i>filled</i>}
      <button onClick={() => setText(text + "ab")}>a</button>
      <button onClick={() => setText("")}>b</button>
    </div>
  );
};
