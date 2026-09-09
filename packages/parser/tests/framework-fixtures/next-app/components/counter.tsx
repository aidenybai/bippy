"use client";

import { useState } from "react";
import { ArrowIcon } from "./icons";

export const Counter = ({ initial }: { initial: number }) => {
  const [count, setCount] = useState(initial);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      {count}
      <ArrowIcon />
    </button>
  );
};
