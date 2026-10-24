import { useState } from "react";

export const NextPageCheck = () => {
  const [page, setPage] = useState(0);
  return (
    <button onClick={() => setPage((page + 1) % 3)}>{page + 1 >= 2 ? "late" : "early"}</button>
  );
};

export const SumCompare = () => {
  const [a, setA] = useState(0);
  const [b] = useState(1);
  return <button onClick={() => setA(a + 1)}>{a + b > 1 ? "big" : "small"}</button>;
};

export const TernaryInCompare = () => {
  const [n, setN] = useState(0);
  const [isDouble, setIsDouble] = useState(false);
  return (
    <div>
      <button onClick={() => setN(n + 1)}>next</button>
      <button onClick={() => setIsDouble(!isDouble)}>double</button>
      {(isDouble ? n * 2 : n) + 1 > 2 ? "high" : "low"}
    </div>
  );
};
