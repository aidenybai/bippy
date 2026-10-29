import { useReducer, useState } from "react";

export const SameObjectSet = () => {
  const [box, setBox] = useState({ open: false });
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          box.open = !box.open;
          setBox(box);
        }}
      >
        flip
      </button>
      <button onClick={() => setTick(tick + 1)}>tick</button>
      {box.open ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

interface Flag {
  open: boolean;
}

const flipInPlace = (state: Flag, action: "flip") => {
  if (action === "flip") state.open = !state.open;
  return state;
};

export const MutatingReducer = () => {
  const [state, dispatch] = useReducer(flipInPlace, { open: false });
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button onClick={() => dispatch("flip")}>flip</button>
      <button onClick={() => setTick(tick + 1)}>tick</button>
      {state.open ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const PushWithoutSet = () => {
  const [items, setItems] = useState<number[]>([]);
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button onClick={() => items.push(2)}>push</button>
      <button onClick={() => setTick(tick + 1)}>tick</button>
      <button onClick={() => setItems([])}>clear</button>
      {items.length > 0 ? <i>yes</i> : <i>no</i>}
    </div>
  );
};
