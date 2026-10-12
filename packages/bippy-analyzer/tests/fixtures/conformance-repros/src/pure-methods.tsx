import { createContext, useContext, useState } from "react";

interface ListState {
  items: string[];
  query?: string;
  refresh: () => void;
}

const ListContext = createContext<ListState>({ items: [], refresh: () => {} });

export function ItemPicker() {
  const list = useContext(ListContext);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div>
      {list.items.length > 0 ? <p>{selected ?? "none"}</p> : <p>empty</p>}
      <button
        onClick={() => {
          const match = list.query?.trim();
          setSelected(list.items.find((item) => item === match) ?? null);
        }}
      >
        pick
      </button>
      <button onClick={() => list.refresh()}>refresh</button>
    </div>
  );
}
