import { useState } from "react";

const INITIAL_TODOS = [
  { id: 1, done: true },
  { id: 2, done: false },
];

export const FindBySelected = () => {
  const [todos] = useState(INITIAL_TODOS);
  const [selected, setSelected] = useState(1);
  return (
    <div>
      <button onClick={() => setSelected(selected === 1 ? 2 : 1)}>pick</button>
      {todos.find((todo) => todo.id === selected)?.done ? <i>done</i> : <i>open</i>}
    </div>
  );
};

export const SecondRow = () => {
  const [rows, setRows] = useState([{ isOn: false }, { isOn: true }]);
  return (
    <div>
      <button onClick={() => setRows([{ isOn: false }, { isOn: false }])}>off</button>
      {rows[1]?.isOn ? <i>on</i> : <i>off</i>}
    </div>
  );
};

export const LiteralIndex = () => {
  const [items, setItems] = useState([2, 3]);
  return (
    <div>
      <button onClick={() => setItems([2, 4])}>set</button>
      {items[1] === 4 ? <i>four</i> : <i>other</i>}
    </div>
  );
};
