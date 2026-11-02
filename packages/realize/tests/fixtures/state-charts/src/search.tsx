import { useState } from "react";

export const SearchList = ({ items }: { items: string[] }) => {
  const [query, setQuery] = useState("");
  const matches = items.filter((item) => item.includes(query));
  return (
    <div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} />
      {items.length === 0 && <p>No items</p>}
      {matches.length > 0 && (
        <ul>
          {matches.map((match) => (
            <li key={match}>{match}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
