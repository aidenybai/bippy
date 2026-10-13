// Reproduces the #97 regression environment: react-refresh installs its
// stub hook, react-dom injects into it (the stub records nothing in the
// renderers map), the app renders, and only afterwards does bippy load.
// bippy must still activate and observe subsequent commits.
import "./install-refresh";

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

const LateApp = () => {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="late-increment" onClick={() => setCount((previous) => previous + 1)}>
      count:{count}
    </button>
  );
};

const bootstrap = async (): Promise<void> => {
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <StrictMode>
      <LateApp />
    </StrictMode>,
  );
  await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));

  const bippy = await import("bippy");
  window.__BIPPY__ = bippy;

  let onActiveFired = false;
  let commitObserved = false;
  bippy.instrument({
    onActive: () => {
      onActiveFired = true;
    },
    onCommitFiberRoot: () => {
      commitObserved = true;
    },
  });

  document.querySelector<HTMLButtonElement>('[data-testid="late-increment"]')!.click();
  await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
  await new Promise((resolveTick) => setTimeout(resolveTick, 50));

  window.__LATE_LOAD_RESULT__ = {
    onActiveFired,
    isInstrumentationActive: bippy.isInstrumentationActive(),
    commitObservedAfterUpdate: commitObserved,
  };
};

void bootstrap();
