import { useState } from "react";

interface Row {
  id: string;
}

export const Picker = ({ data }: { data: { rows: Row[] } | null }) => {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ul>
      {data?.rows.map((row) => (
        <li key={row.id}>
          <button onClick={() => setSelected(row.id)}>{row.id}</button>
        </li>
      ))}
      {selected && <p>{selected}</p>}
    </ul>
  );
};
