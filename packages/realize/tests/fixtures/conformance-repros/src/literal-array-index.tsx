import { useState } from "react";

export const FirstItemCheck = () => {
  const [items, setItems] = useState<number[]>([1]);
  return <button onClick={() => setItems([9])}>{items[0] === 9 ? "nine" : "other"}</button>;
};

export const NestedRowFlag = () => {
  const [rows, setRows] = useState([{ isOn: false }]);
  return <button onClick={() => setRows([{ isOn: true }])}>{rows[0].isOn ? "on" : "off"}</button>;
};

export const PastTheEnd = () => {
  const [items, setItems] = useState<number[]>([1]);
  return (
    <button onClick={() => setItems([1, 2])}>{items[1] === undefined ? "short" : "long"}</button>
  );
};
