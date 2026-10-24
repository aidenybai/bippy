import { useState } from "react";

export const FilteredLiteralLength = () => {
  const [n, setN] = useState(0);
  return (
    <button onClick={() => setN([1, 2, 3].filter((value) => value > 1).length)}>
      {n === 2 ? "two" : n === 0 ? "zero" : "other"}
    </button>
  );
};

export const MappedLiteralItem = () => {
  const [n, setN] = useState(0);
  return (
    <button onClick={() => setN([1, 2].map((value) => value * 3)[1])}>
      {n === 6 ? "six" : n === 0 ? "zero" : "other"}
    </button>
  );
};

export const SomeOfLiteral = () => {
  const [isOn, setIsOn] = useState(false);
  return (
    <button onClick={() => setIsOn([1, 2].some((value) => value > 1))}>
      {isOn ? "on" : "off"}
    </button>
  );
};
