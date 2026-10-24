import { useState } from "react";

export const DestructuredRead = () => {
  const [total, setTotal] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          const [first, second, third] = [1, 2, 3];
          setTotal(first + second + third);
        }}
      >
        go
      </button>
      {total === 6 ? <i>six</i> : total === 0 ? <i>zero</i> : <i>Z1</i>}
    </div>
  );
};

export const FieldRead = () => {
  const [total, setTotal] = useState(0);
  const { a, b } = { a: 1, b: 5 };
  return (
    <div>
      <button onClick={() => setTotal(a * b - 2)}>go</button>
      {total === 3 ? <i>three</i> : total === 0 ? <i>zero</i> : <i>Z1</i>}
    </div>
  );
};

export const JoinedRead = () => {
  const [label, setLabel] = useState("");
  const [prefix, suffix] = ["L", "2"];
  return (
    <div>
      <button onClick={() => setLabel(prefix + suffix)}>go</button>
      {label === "L2" ? <i>L2</i> : label === "" ? <i>L1</i> : <i>Z1</i>}
    </div>
  );
};
