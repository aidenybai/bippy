import { useState } from "react";

export const ForEachPush = () => {
  const [items, setItems] = useState([2, 1]);
  return (
    <div>
      <button
        onClick={() => {
          const out: number[] = [];
          items.forEach((item) => out.push(item + 1));
          setItems(out);
        }}
      >
        bump
      </button>
      {items.length === 2 ? <i>pair</i> : <i>other</i>}
    </div>
  );
};

export const ForEachPushInRender = ({ items }: { items: number[] }) => {
  const doubled: number[] = [];
  items.forEach((item) => doubled.push(item * 2));
  return <p>{doubled.length === 0 ? "empty" : "some"}</p>;
};
