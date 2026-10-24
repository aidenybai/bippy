import { useState } from "react";

export const SetThenMap = () => {
  const [items, setItems] = useState([2, 1]);
  return (
    <div>
      <button
        onClick={() => {
          setItems([2]);
          setItems(items.map((item) => item + 1));
        }}
      >
        go
      </button>
      {items.length === 2 ? <i>pair</i> : <i>other</i>}
      {items[0] === 3 ? <i>three</i> : null}
    </div>
  );
};

export const ClearThenMap = () => {
  const [items, setItems] = useState([1]);
  return (
    <div>
      <button
        onClick={() => {
          setItems([]);
          setItems(items.map((item) => (item > 1 ? 1 : 2)));
        }}
      >
        go
      </button>
      {items.length === 0 ? <i>empty</i> : items[0] === 2 ? <i>two</i> : <i>one</i>}
    </div>
  );
};
