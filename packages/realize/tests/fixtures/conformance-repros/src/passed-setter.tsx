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

interface ListProps {
  ids: string[];
  renderAction: (id: string) => React.ReactNode;
}

const List = ({ ids, renderAction }: ListProps) => (
  <ul>
    {ids.map((id) => (
      <li key={id}>{renderAction(id)}</li>
    ))}
  </ul>
);

export const DeletableList = ({ ids }: { ids: string[] }) => {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  return (
    <div>
      <List
        ids={ids}
        renderAction={(id) => <button onClick={() => setDeletingId(id)}>Delete</button>}
      />
      {deletingId === null ? null : <p>Delete {deletingId}?</p>}
    </div>
  );
};

const Dialog = ({ desc }: { desc: React.ReactNode }) => <section>{desc}</section>;

export const ConfirmDelete = () => {
  const [value, setValue] = useState("");
  return (
    <Dialog
      desc={
        <label>
          <input value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
      }
    />
  );
};

const countNodes = (nodes: string[][], visit: (node: string[]) => number): number =>
  nodes.reduce((total, node) => total + visit(node), 0);

export const NodeCount = ({ nodes }: { nodes: string[][] }) => {
  const visit = (node: string[]): number => 1 + countNodes([node.slice(1)], visit);
  return <p>{countNodes(nodes, visit)}</p>;
};
