import "bippy/install-hook-only";

import { getRDTHook } from "bippy";
import { createElement, useEffect, useState } from "react";
import { expect, it } from "vite-plus/test";

import { installConditionalHooks } from "./conditional-hooks";

interface ConditionalCounterProps {
  effectEvents: string[];
  isEnabled: boolean;
}

const ConditionalCounter = ({ effectEvents, isEnabled }: ConditionalCounterProps) => {
  if (!isEnabled) return <span>disabled</span>;

  const [count, setCount] = useState(0);
  useEffect(() => {
    effectEvents.push(`start:${count}`);
    return () => {
      effectEvents.push(`stop:${count}`);
    };
  }, [count, effectEvents]);

  return <button onClick={() => setCount((value) => value + 1)}>{count}</button>;
};

installConditionalHooks();
getRDTHook().checkDCE = () => {};

const waitForEffects = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

it("preserves conditional state and cleans up conditional effects", async () => {
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");

  const effectEvents: string[] = [];
  const container = document.createElement("div");
  const root = createRoot(container);

  flushSync(() => {
    root.render(createElement(ConditionalCounter, { effectEvents, isEnabled: false }));
  });

  expect(container.textContent).toBe("disabled");

  flushSync(() => {
    root.render(createElement(ConditionalCounter, { effectEvents, isEnabled: true }));
  });
  expect(container.querySelector("button")?.textContent).toBe("0");

  flushSync(() => {
    container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(container.querySelector("button")?.textContent).toBe("1");

  flushSync(() => {
    root.render(createElement(ConditionalCounter, { effectEvents, isEnabled: false }));
  });
  await waitForEffects();
  expect(container.textContent).toBe("disabled");
  expect(effectEvents).toContain("stop:1");

  flushSync(() => {
    root.render(createElement(ConditionalCounter, { effectEvents, isEnabled: true }));
  });
  expect(container.querySelector("button")?.textContent).toBe("1");

  flushSync(() => root.unmount());
});
