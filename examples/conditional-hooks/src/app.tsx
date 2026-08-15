import { useEffect, useMemo, useRef, useState } from "react";

interface CounterProps {
  isEnabled: boolean;
}

const ConditionalCounter = ({ isEnabled }: CounterProps) => {
  if (!isEnabled) {
    return <p className="empty">The component returned before calling any demo hooks.</p>;
  }

  const [count, setCount] = useState(0);
  const renderCount = useRef(0);
  renderCount.current++;

  const doubledCount = useMemo(() => count * 2, [count]);

  useEffect(() => {
    document.title = `Conditional count: ${count}`;
    return () => {
      document.title = "Conditional hooks with Bippy";
    };
  }, [count]);

  return (
    <div className="counter">
      <button onClick={() => setCount((value) => value + 1)}>Count: {count}</button>
      <span>Doubled: {doubledCount}</span>
      <span>Renders: {renderCount.current}</span>
    </div>
  );
};

const App = () => {
  const [isEnabled, setIsEnabled] = useState(false);

  return (
    <main>
      <p className="eyebrow">Bippy experiment</p>
      <h1>Conditional hooks without changing component code</h1>
      <p className="lede">
        The Vite plugin initializes each function component through Bippy. The hooks below can be
        skipped and re-entered in both development and production builds.
      </p>
      <label className="toggle">
        <input
          checked={isEnabled}
          onChange={(event) => setIsEnabled(event.currentTarget.checked)}
          type="checkbox"
        />
        Call the conditional hooks
      </label>
      <ConditionalCounter isEnabled={isEnabled} />
      <p className="note">
        Increment the counter, disable the branch, then enable it again. Its state is preserved.
      </p>
    </main>
  );
};

export default App;
