// Concurrent-feature stress: interruptible transitions over a large
// filtered list, use()-driven Suspense resolution cycles, and root
// mount/unmount churn that guards bippy's root tracking against leaks.
import * as bippy from "bippy";
import * as React from "react";
import { createRoot } from "react-dom/client";

const LIST_ITEMS = Array.from({ length: 2000 }, (_, itemIndex) => `item-${itemIndex}`);

interface TransitionStressResult {
  commitCount: number;
  finalQuery: string;
  renderedMatches: number;
  expectedMatches: number;
  isPendingSettled: boolean;
}

interface FilteredListProps {
  deferredQuery: string;
}

const FilteredList = ({ deferredQuery }: FilteredListProps) => {
  const filteredItems = React.useMemo(
    () => LIST_ITEMS.filter((item) => item.includes(deferredQuery)),
    [deferredQuery],
  );
  return (
    <ul data-testid="filtered-list" data-count={filteredItems.length}>
      {filteredItems.slice(0, 20).map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
};

interface TransitionHarnessHandle {
  setQuery: (query: string) => void;
  isPending: () => boolean;
}

const transitionHandle: TransitionHarnessHandle = {
  setQuery: () => {},
  isPending: () => false,
};

const TransitionApp = () => {
  const [query, setQuery] = React.useState("");
  const [isPending, startTransition] = React.useTransition();
  const deferredQuery = React.useDeferredValue(query);
  transitionHandle.setQuery = (nextQuery) => {
    startTransition(() => {
      setQuery(nextQuery);
    });
  };
  transitionHandle.isPending = () => isPending;
  return (
    <div>
      <output data-testid="current-query">{query}</output>
      <FilteredList deferredQuery={deferredQuery} />
    </div>
  );
};

export const runTransitionStress = async (updateCount: number): Promise<TransitionStressResult> => {
  let commitCount = 0;
  const unsubscribe = bippy.instrument({
    onCommitFiberRoot: () => {
      commitCount++;
    },
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(<TransitionApp />);
  await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));

  // Rapid interleaved transitions: every update supersedes the previous
  // one before it finishes, forcing interrupted and restarted renders.
  const finalQuery = `item-1${String(updateCount % 10)}`;
  for (let updateIndex = 0; updateIndex < updateCount; updateIndex++) {
    transitionHandle.setQuery(`item-${String(updateIndex % 100)}`);
    if (updateIndex % 3 === 0) {
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    }
  }
  transitionHandle.setQuery(finalQuery);

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    const listElement = container.querySelector('[data-testid="filtered-list"]');
    const queryElement = container.querySelector('[data-testid="current-query"]');
    if (queryElement?.textContent === finalQuery && listElement && !transitionHandle.isPending()) {
      break;
    }
  }
  await new Promise((resolveTick) => setTimeout(resolveTick, 100));

  const listElement = container.querySelector('[data-testid="filtered-list"]');
  const result: TransitionStressResult = {
    commitCount,
    finalQuery: container.querySelector('[data-testid="current-query"]')?.textContent ?? "",
    renderedMatches: Number(listElement?.getAttribute("data-count") ?? -1),
    expectedMatches: LIST_ITEMS.filter((item) => item.includes(finalQuery)).length,
    isPendingSettled: !transitionHandle.isPending(),
  };

  root.unmount();
  container.remove();
  unsubscribe();
  return result;
};

interface SuspenseCycleResult {
  resolvedCycles: number;
  commitCount: number;
}

export const runSuspenseCycles = async (cycleCount: number): Promise<SuspenseCycleResult> => {
  let commitCount = 0;
  const unsubscribe = bippy.instrument({
    onCommitFiberRoot: () => {
      commitCount++;
    },
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let resolvedCycles = 0;

  interface CycleProps {
    cyclePromise: Promise<string>;
  }

  const CycleContent = ({ cyclePromise }: CycleProps) => {
    const value = React.use(cyclePromise);
    return <output data-testid="cycle-value">{value}</output>;
  };

  for (let cycleIndex = 0; cycleIndex < cycleCount; cycleIndex++) {
    let resolveCycle: (value: string) => void = () => {};
    const cyclePromise = new Promise<string>((innerResolve) => {
      resolveCycle = innerResolve;
    });
    root.render(
      <React.Suspense fallback={<output data-testid="cycle-value">pending</output>}>
        <CycleContent cyclePromise={cyclePromise} />
      </React.Suspense>,
    );
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    resolveCycle(`cycle-${cycleIndex}`);

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
      const valueElement = container.querySelector('[data-testid="cycle-value"]');
      if (valueElement?.textContent === `cycle-${cycleIndex}`) {
        resolvedCycles++;
        break;
      }
    }
  }

  root.unmount();
  container.remove();
  unsubscribe();
  return { resolvedCycles, commitCount };
};

interface RootChurnResult {
  fiberRootCountBaseline: number;
  fiberRootCountWhileMounted: number;
  fiberRootCountAfterUnmount: number;
  instrumentationStillActive: boolean;
}

// Guards the #97 territory: unmounted roots must leave bippy's root
// tracking, and instrumentation must survive heavy root churn.
export const runRootChurn = async (rootCount: number): Promise<RootChurnResult> => {
  const fiberRootCountBaseline = bippy._fiberRoots.size;

  const churnEntries = Array.from({ length: rootCount }, () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    return { container, root: createRoot(container) };
  });

  for (const [entryIndex, entry] of churnEntries.entries()) {
    entry.root.render(<output>churn-{entryIndex}</output>);
  }
  await new Promise((resolveTick) => setTimeout(resolveTick, 150));
  const fiberRootCountWhileMounted = bippy._fiberRoots.size;

  for (const entry of churnEntries) {
    entry.root.unmount();
    entry.container.remove();
  }
  await new Promise((resolveTick) => setTimeout(resolveTick, 150));

  return {
    fiberRootCountBaseline,
    fiberRootCountWhileMounted,
    fiberRootCountAfterUnmount: bippy._fiberRoots.size,
    instrumentationStillActive: bippy.isInstrumentationActive(),
  };
};
