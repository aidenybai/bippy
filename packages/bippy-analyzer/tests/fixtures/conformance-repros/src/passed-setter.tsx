import { useState } from "react";

interface SearchProps {
  searchTerm: string;
  setSearchTerm: (searchTerm: string) => void;
}

const Search = ({ searchTerm, setSearchTerm }: SearchProps) => (
  <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
);

export const SearchPanel = () => {
  const [searchTerm, setSearchTerm] = useState("");
  return (
    <div>
      <Search searchTerm={searchTerm} setSearchTerm={setSearchTerm} />
      {searchTerm === "" ? <p>Type to search</p> : <p>Results</p>}
    </div>
  );
};
