import { useState } from "react";

export const LoopList = ({ items }: { items: string[] }) => {
  const [isSelected, setIsSelected] = useState(false);
  const rows = [];
  let hasLong = false;
  for (const item of items) {
    rows.push(<li key={item}>{item}</li>);
    if (item.length > 3) hasLong = true;
  }
  const selectAll = () => {
    for (const item of items) {
      if (item) setIsSelected(true);
    }
  };
  return (
    <div>
      <ul>{rows}</ul>
      {hasLong && <p>Long</p>}
      <button type="button" onClick={selectAll}>
        {isSelected ? "Selected" : "Select"}
      </button>
    </div>
  );
};

export const FirstMatch = ({ items, query }: { items: string[]; query: string }) => {
  let found: string | null = null;
  for (let index = 0; index < items.length; index++) {
    if (items[index] === query) {
      found = items[index] ?? null;
      break;
    }
  }
  if (found === null) return <p>No match</p>;
  return <p>Found {found}</p>;
};

export const Countdown = ({ start }: { start: number }) => {
  let steps = 0;
  let value = start;
  while (value > 0) {
    value -= 1;
    steps += 1;
  }
  return <p>{steps === 0 ? "Done" : "Counted"}</p>;
};
