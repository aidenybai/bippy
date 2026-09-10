import * as React from "react";
import {
  getFiberById,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  traverseFiber,
  type Fiber,
} from "bippy";
import { expect, it } from "vite-plus/test";
import { createRenderHarness } from "./render-harness.js";

interface PrimaryProps {
  value: number;
}

interface RenderAttempt extends PrimaryProps {
  fiber: Fiber;
}

it("never promotes suspended work over the committed alternate, even after the transition is abandoned", async () => {
  const harness = createRenderHarness();
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber)
    throw new Error("Expected the development renderer's current-fiber oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const attempts: RenderAttempt[] = [];
  let updateValue: React.Dispatch<React.SetStateAction<number>> = () => {
    throw new Error("Component has not mounted");
  };
  const pending = Promise.withResolvers<void>();
  let isResolved = false;
  const Primary = ({ value }: PrimaryProps) => {
    const fiber = getRenderingFiber();
    if (!fiber) throw new Error("Missing rendering fiber");
    attempts.push({ value, fiber });
    if (value === 1 && !isResolved) throw pending.promise;
    return <span>{value}</span>;
  };
  const App = () => {
    const [value, setValue] = React.useState(0);
    updateValue = setValue;
    return (
      <React.Suspense fallback={<span>loading</span>}>
        <Primary value={value} />
      </React.Suspense>
    );
  };
  await harness.render(<App />);
  const firstRoot = harness.getRoot().current;
  const firstFiber = traverseFiber(firstRoot, (fiber) => fiber.type === Primary);
  if (!firstFiber) throw new Error("Missing committed primary");
  const identifier = getFiberId(firstFiber);

  await React.act(async () => {
    React.startTransition(() => updateValue(1));
  });
  const suspendedAttempt = attempts.find((attempt) => attempt.value === 1);
  if (!suspendedAttempt) throw new Error("Transition did not attempt to render");
  expect(suspendedAttempt.fiber).not.toBe(firstFiber);
  expect(suspendedAttempt.fiber.alternate).toBe(firstFiber);
  expect(harness.getRoot().current).toBe(firstRoot);
  expect(harness.container.textContent).toBe("0");
  expect(getLatestFiber(suspendedAttempt.fiber)).toBe(firstFiber);
  expect(getLatestFiber(firstFiber)).toBe(firstFiber);
  expect(getFiberId(suspendedAttempt.fiber)).toBe(identifier);
  expect(getFiberById(identifier)).toBe(firstFiber);

  await React.act(async () => updateValue(2));
  const finalFiber = traverseFiber(harness.getRoot().current, (fiber) => fiber.type === Primary);
  if (!finalFiber) throw new Error("Missing final primary");
  expect(harness.container.textContent).toBe("2");
  expect(getLatestFiber(firstFiber)).toBe(finalFiber);
  expect(getLatestFiber(suspendedAttempt.fiber)).toBe(finalFiber);
  expect(getFiberById(identifier)).toBe(finalFiber);
  expect(getFiberId(finalFiber)).toBe(identifier);

  await React.act(async () => {
    isResolved = true;
    pending.resolve();
    await pending.promise;
  });
  expect(harness.container.textContent).toBe("2");
  expect(getFiberById(identifier)).toBe(finalFiber);
  await harness.render(null);
  expect(getFiberById(identifier)).toBeNull();
});
