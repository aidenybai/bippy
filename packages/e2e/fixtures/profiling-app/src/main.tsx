import "bippy/install-hook-only";

import * as bippy from "bippy";
import { Profiler, useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    __BIPPY__: typeof bippy;
  }
}

window.__BIPPY__ = bippy;

const Counter = () => {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="increment" onClick={() => setCount((previous) => previous + 1)}>
      count:{count}
    </button>
  );
};

const App = () => (
  <Profiler id="profiling-app" onRender={() => {}}>
    <div data-testid="test-child">
      <Counter />
    </div>
  </Profiler>
);

createRoot(document.getElementById("root")!).render(<App />);
