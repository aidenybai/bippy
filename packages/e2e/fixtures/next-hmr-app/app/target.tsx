"use client";

// Overwritten by tests/web/hmr/next-hmr.spec.ts at runtime and restored
// afterwards. Keep in sync with nextCounterSource("v1") in that spec.
import { useState } from "react";

export const Target = () => {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="target" data-version="v1" onClick={() => setCount(count + 1)}>
      v1:{count}
    </button>
  );
};
