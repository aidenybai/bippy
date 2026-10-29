import { useState } from "react";

const INITIAL_TODOS = [
  { id: 1, done: true },
  { id: 2, done: false },
];

export const SelectedSome = () => {
  const [todos] = useState(INITIAL_TODOS);
  const [selected, setSelected] = useState(1);
  return (
    <div>
      <button onClick={() => setSelected(selected === 1 ? 3 : 1)}>pick</button>
      {todos.some((todo) => todo.id === selected) ? <i>found</i> : <i>missing</i>}
    </div>
  );
};

export const FilteredCount = () => {
  const [todos] = useState(INITIAL_TODOS);
  const [filter, setFilter] = useState("all");
  return (
    <div>
      <button onClick={() => setFilter(filter === "all" ? "done" : "all")}>filter</button>
      {todos.filter((todo) => (filter === "all" ? true : todo.done)).length === 2 ? (
        <i>both</i>
      ) : (
        <i>one</i>
      )}
    </div>
  );
};

export const SelectedIndex = () => {
  const [todos] = useState(INITIAL_TODOS);
  const [selected, setSelected] = useState(2);
  return (
    <div>
      <button onClick={() => setSelected(selected === 2 ? 1 : 2)}>pick</button>
      {todos.findIndex((todo) => todo.id === selected) === 1 ? <i>second</i> : <i>other</i>}
    </div>
  );
};
