// Overwritten by tests/web/hmr specs at runtime and restored afterwards.
// Keep in sync with INITIAL_TARGET_SOURCE in tests/web/hmr/target-sources.ts.
import { useState } from "react";

export const Target = () => {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="target" data-version="v1" onClick={() => setCount(count + 1)}>
      v1:{count}
    </button>
  );
};
