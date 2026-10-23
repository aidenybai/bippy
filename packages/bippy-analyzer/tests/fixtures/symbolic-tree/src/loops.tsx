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

export const CountedLoop = () => {
  const [isDone, setIsDone] = useState(false);
  const finish = () => {
    let total = 0;
    for (let index = 0; index < 3; index++) total += 2;
    setIsDone(total === 6);
  };
  return (
    <button type="button" onClick={finish}>
      {isDone ? "Done" : "Start"}
    </button>
  );
};

export const SkippedSteps = () => {
  const [steps, setSteps] = useState(0);
  const advance = () => {
    let count = 0;
    let index = 0;
    do {
      index++;
      if (index % 2 === 0) continue;
      count++;
    } while (index < 5);
    setSteps(count);
  };
  return (
    <button type="button" onClick={advance}>
      {steps === 0 ? "None" : steps === 3 ? "Three" : "Other"}
    </button>
  );
};

export const EarlyReturn = () => {
  const [picked, setPicked] = useState(0);
  const findFirstSquare = () => {
    for (let index = 1; index < 10; index++) if (index * index > 5) return index;
    return -1;
  };
  return (
    <button type="button" onClick={() => setPicked(findFirstSquare())}>
      {picked === 0 ? "Pick" : picked === 3 ? "Third" : "Other"}
    </button>
  );
};

export const LongLoop = () => {
  const [isFull, setIsFull] = useState(false);
  const fill = () => {
    let total = 0;
    for (let index = 0; index < 100; index++) total++;
    setIsFull(total === 100);
  };
  return (
    <button type="button" onClick={fill}>
      {isFull ? "Full" : "Fill"}
    </button>
  );
};
