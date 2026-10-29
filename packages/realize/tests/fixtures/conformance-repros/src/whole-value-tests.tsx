import { useState } from "react";

export const HasOwnFlags = () => {
  const [flags, setFlags] = useState<Record<string, boolean>>({ b: false });
  return <button onClick={() => setFlags({})}>{Object.hasOwn(flags, "b") ? "yes" : "no"}</button>;
};

export const KeysLength = () => {
  const [flags, setFlags] = useState<Record<string, boolean>>({ b: false });
  return (
    <button onClick={() => setFlags({})}>
      {Object.keys(flags).length === 0 ? "empty" : "some"}
    </button>
  );
};

export const ReduceSum = () => {
  const [items, setItems] = useState([1, 2]);
  return (
    <button onClick={() => setItems([...items, 5])}>
      {items.reduce((sum, item) => sum + item, 0) > 2 ? "big" : "small"}
    </button>
  );
};

export const InFlags = () => {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  return (
    <button onClick={() => setFlags({ ...flags, a: true })}>{"a" in flags ? "yes" : "no"}</button>
  );
};

export const InFlagsHas = () => {
  const [flags, setFlags] = useState<Record<string, boolean>>({ a: true });
  return <button onClick={() => setFlags({})}>{"a" in flags ? "yes" : "no"}</button>;
};

export const InheritedKey = () => {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  return (
    <button onClick={() => setFlags({ a: true })}>{"toString" in flags ? "yes" : "no"}</button>
  );
};
