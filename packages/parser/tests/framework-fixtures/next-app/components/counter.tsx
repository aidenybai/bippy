"use client";

import { useState } from "react";

export const Counter = ({ initial }: { initial: number }) => {
  const [count, setCount] = useState(initial);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      {count}
    </button>
  );
};
