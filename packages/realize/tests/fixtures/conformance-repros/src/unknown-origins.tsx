import { useEffect, useState } from "react";

declare const fetchItems: () => Promise<string[]>;

export const FetchedItems = () => {
  const [items, setItems] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetchItems()
      .then(setItems)
      .catch(() => setFailed(true));
  }, []);
  return <p>{failed ? "failed" : items.length}</p>;
};

export const DraftInput = () => {
  const [draft, setDraft] = useState("");
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
};

export const StampedEntry = () => {
  const [entry, setEntry] = useState({ id: 0 });
  return <button onClick={() => setEntry({ id: Date.now() })}>{entry.id}</button>;
};
