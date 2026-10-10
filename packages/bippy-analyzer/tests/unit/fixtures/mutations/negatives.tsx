// @ts-nocheck
import { useState } from "react";
import { save } from "./store";

export const Dismiss = ({ id, onDismiss }: { id: string; onDismiss: (id: string) => void }) => (
  <button onClick={() => onDismiss(id)}>Dismiss</button>
);

export const MappedList = ({ items }: { items: string[] }) => (
  <ul>
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);

export const FilteredCount = ({ items }: { items: string[] }) => (
  <p>{items.filter((item) => item.length > 0).length}</p>
);

export const SortedCopy = ({ items }: { items: string[] }) => {
  const sorted = [...items].sort();
  return <p>{sorted.join(", ")}</p>;
};

export const LocalArray = ({ label }: { label: string }) => {
  const parts: string[] = [];
  parts.push(label);
  return <p>{parts.join(" ")}</p>;
};

export const FunctionalUpdate = () => {
  const [items, setItems] = useState<string[]>([]);
  return (
    <div>
      <button onClick={() => setItems((previous) => [...previous, "next"])}>Add</button>
      {items.length === 0 ? <p>Empty</p> : <p>Some</p>}
    </div>
  );
};

export const SortedState = () => {
  const [items, setItems] = useState<string[]>([]);
  const sort = () => setItems([...items].sort());
  return <button onClick={sort}>{items.length}</button>;
};

export const CopyInHandler = () => {
  const [items, setItems] = useState<string[]>([]);
  const add = () => {
    const next = [...items];
    next.push("next");
    setItems(next);
  };
  return <button onClick={add}>{items.length}</button>;
};

export const PassToFunction = () => {
  const [items] = useState<string[]>([]);
  return <button onClick={() => save(items)}>{items.length}</button>;
};
