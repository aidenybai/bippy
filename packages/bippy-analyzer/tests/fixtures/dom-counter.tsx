import * as React from "react";
import { createRoot, type Root } from "react-dom/client";

const events: string[] = [];
export let commits = 0;
export const errors: unknown[] = [];
let root: Root | undefined;
const container = document.getElementById("root");
if (!container) throw new Error("Missing fixture container");

const Counter = () => {
  const [count, setCount] = React.useState(0);
  const [step, setStep] = React.useState(1);
  const [visible, setVisible] = React.useState(true);
  React.useLayoutEffect(() => {
    events.push(`layout:${count}`);
    return () => {
      events.push(`layout-cleanup:${count}`);
    };
  }, [count]);
  React.useEffect(() => {
    events.push(`effect:${count}`);
    return () => {
      events.push(`effect-cleanup:${count}`);
    };
  }, [count]);
  React.useEffect(() => {
    commits++;
  });
  return (
    <main>
      <button id="increase" onClick={() => setCount((previous) => previous + step)}>
        Increase
      </button>
      <button id="decrease" onClick={() => setCount((previous) => previous - step)}>
        Decrease
      </button>
      <button id="reset" onClick={() => setCount(0)}>
        Reset
      </button>
      <button id="step" onClick={() => setStep(5)}>
        Step: {step}
      </button>
      <button id="toggle" onClick={() => setVisible((previous) => !previous)}>
        Toggle
      </button>
      {visible ? <output id="count">{count}</output> : null}
    </main>
  );
};

export const owned = [React.useState, createRoot, Counter, document.createElement, window.Event];
export const mount = (strict = false) => {
  root = createRoot(container, {
    onUncaughtError: (error) => {
      errors.push(error);
    },
    onRecoverableError: (error) => {
      errors.push(error);
    },
  });
  root.render(
    strict ? (
      <React.StrictMode>
        <Counter />
      </React.StrictMode>
    ) : (
      <Counter />
    ),
  );
};
export const click = (buttonId: string) => {
  const button = document.getElementById(buttonId);
  if (!button) throw new Error(`Missing button: ${buttonId}`);
  button.dispatchEvent(new window.Event("click", { bubbles: true }));
};
export const unmount = () => {
  root!.unmount();
};
export const observe = () =>
  JSON.stringify({
    html: container.innerHTML,
    events,
    errors: errors.map((error) => String(error)),
  });
