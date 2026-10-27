import { useState } from "react";

export const PushedTableIndex = () => {
  const [n, setN] = useState(0);
  const table = [() => setN(1), () => setN(2)];
  return (
    <div>
      {n === 2 ? <i>two</i> : <i>other</i>}
      <button onClick={() => table.push(() => setN(0))}>add</button>
      <button onClick={() => table[1]()}>run</button>
    </div>
  );
};

export const ValuesIndex = () => {
  const [n, setN] = useState(0);
  const [table] = useState<Record<string, () => void>>(() => ({
    one: () => setN(1),
    two: () => setN(2),
  }));
  return (
    <div>
      {n === 2 ? <i>two</i> : <i>other</i>}
      <button onClick={() => Object.values(table)[1]()}>run</button>
    </div>
  );
};
