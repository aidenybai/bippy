import { useState } from "react";

declare const load: () => Promise<void>;

export const AsyncObject = () => {
  const [position, setPosition] = useState({ x: 1, y: 1 });
  const [items, setItems] = useState<number[]>([1]);
  const [label, setLabel] = useState("a");
  const handleReset = async () => {
    await load();
    setPosition({ x: 0, y: 0 });
    setItems([]);
    setLabel("b");
  };
  return (
    <button onClick={handleReset}>
      {position.x} {items.length} {label}
    </button>
  );
};

export const AsyncAppend = () => {
  const [items, setItems] = useState<number[]>([1]);
  const handleAdd = async () => {
    await load();
    setItems([...items, 2]);
  };
  return <button onClick={handleAdd}>{items.length}</button>;
};
