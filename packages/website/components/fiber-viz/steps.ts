export type FiberVizMode =
  | "elements"
  | "tree"
  | "pointers"
  | "traversal"
  | "alternate"
  | "rerender"
  | "commit"
  | "instrument";

export interface FiberVizStep {
  id: string;
  title: string;
  body: string;
  mode: FiberVizMode;
  code?: string;
  codeLanguage?: string;
  highlightedLines?: number[];
}

const COUNTER_APP_CODE = `const App = () => <Counter />;

const Counter = () => {
  const [count, setCount] = useState(0);
  return (
    <>
      <p>{count}</p>
      <button onClick={() => setCount(count + 1)}>
        +1
      </button>
    </>
  );
};

createRoot(rootElement).render(<App />);`;

const BIPPY_INSTRUMENT_CODE = `import { instrument, traverseRenderedFibers } from "bippy";

instrument({
  onCommitFiberRoot(rendererID, root) {
    traverseRenderedFibers(root, (fiber, phase) => {
      console.log(phase, getDisplayName(fiber.type));
    });
  },
});`;

export const FIBER_VIZ_STEPS: FiberVizStep[] = [
  {
    id: "elements",
    title: "you write jsx",
    body: "jsx compiles into `createElement` calls that return elements: plain objects describing what the UI should look like. at this point react hasn't done any work, they're only descriptions.",
    mode: "elements",
    code: COUNTER_APP_CODE,
    codeLanguage: "jsx",
    highlightedLines: [5, 6, 7, 8, 9, 10, 11, 12],
  },
  {
    id: "tree",
    title: "react builds a fiber tree",
    body: 'on first render, react turns every element into a **fiber**: a "unit of execution" that holds the component\'s type, props, state, and effects. your whole app becomes a tree of fibers, from the root down to every dom node and text.',
    mode: "tree",
    code: COUNTER_APP_CODE,
    codeLanguage: "jsx",
    highlightedLines: [15],
  },
  {
    id: "pointers",
    title: "fibers are a linked list",
    body: "each fiber points to its first `child`, its next `sibling`, and back up to its `return` parent. this shape lets react walk the entire tree iteratively with a plain loop: no recursion, so react can pause work and pick up exactly where it left off.",
    mode: "pointers",
  },
  {
    id: "traversal",
    title: "render works one fiber at a time",
    body: "during the render phase, react processes one fiber at a time: `beginWork` goes child-first, and when a fiber has no child, `completeWork` climbs back up through `return` and moves to the next `sibling`. watch the cursor: this is the exact order.",
    mode: "traversal",
  },
  {
    id: "alternate",
    title: "there are two trees",
    body: "react is double-buffered. the `current` tree is what's on screen; updates are built into a work-in-progress copy, and every fiber links to its twin through `alternate`. when the new tree is complete, react swaps the root pointer and the copies trade places.",
    mode: "alternate",
  },
  {
    id: "rerender",
    title: "state updates re-render a subtree",
    body: "click **+1**: `setCount` schedules work on `Counter`. react re-renders `Counter` and its children, but `App` and the root **bail out**: they're still in the tree, they just didn't render. knowing which fibers actually rendered is most of the battle.",
    mode: "rerender",
    code: COUNTER_APP_CODE,
    codeLanguage: "jsx",
    highlightedLines: [4, 8],
  },
  {
    id: "commit",
    title: "commit flushes to the dom",
    body: "once the work-in-progress tree is ready, react mutates the real dom in one synchronous pass. then it calls `onCommitFiberRoot` on `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` with the finished root. this hook exists for react devtools.",
    mode: "commit",
  },
  {
    id: "instrument",
    title: "bippy is listening",
    body: "bippy pretends to be react devtools, so react hands it every committed root. `instrument` subscribes to the hook, and `traverseRenderedFibers` tells you exactly which fibers rendered and why. that's the whole trick: everything else is utilities on top.",
    mode: "instrument",
    code: BIPPY_INSTRUMENT_CODE,
    codeLanguage: "typescript",
    highlightedLines: [3, 4, 5],
  },
];
