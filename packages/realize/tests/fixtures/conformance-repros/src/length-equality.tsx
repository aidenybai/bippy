import { useState } from "react";

export const LenEqual = () => {
  const [items, setItems] = useState<string[]>([]);
  return (
    <div>
      <button onClick={() => setItems(["x"])}>one</button>
      <button onClick={() => setItems([])}>clear</button>
      {items.length === 0 ? <p>empty</p> : <p>full</p>}
    </div>
  );
};

export const LenTwo = () => {
  const [items, setItems] = useState<string[]>([]);
  return (
    <div>
      <button onClick={() => setItems(["x", "y"])}>two</button>
      <button onClick={() => setItems([])}>clear</button>
      {items.length === 2 ? <p>pair</p> : <p>other</p>}
    </div>
  );
};

export const TextEmpty = () => {
  const [text, setText] = useState("");
  return (
    <div>
      <button onClick={() => setText("x")}>type</button>
      <button onClick={() => setText("")}>clear</button>
      {text.length === 0 ? <p>empty</p> : <p>typed</p>}
    </div>
  );
};
