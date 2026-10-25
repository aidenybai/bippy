import { useState } from "react";

export const ConcatList = () => {
  const [items, setItems] = useState<number[]>([]);
  return (
    <div>
      <button onClick={() => setItems(items.concat(1))}>add</button>
      <button onClick={() => setItems([])}>clear</button>
      {items.length > 0 ? <i>filled</i> : <i>empty</i>}
    </div>
  );
};

export const AppendedText = () => {
  const [text, setText] = useState("");
  return (
    <div>
      <button onClick={() => setText(text + "a")}>type</button>
      <button onClick={() => setText("")}>clear</button>
      {text.length > 0 ? <i>typed</i> : <i>blank</i>}
    </div>
  );
};
