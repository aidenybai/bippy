"use client";

import * as bippy from "bippy";
import * as bippySource from "bippy/source";
import React, {
  Component,
  Fragment,
  Suspense,
  createContext,
  forwardRef,
  memo,
  useContext,
  useEffect,
  useState,
} from "react";

declare global {
  interface Window {
    __BIPPY__: typeof bippy & typeof bippySource;
  }
}

const TestContext = createContext("default-context");

export const TestParent = () => {
  const [count, setCount] = useState(0);
  const [showConditional, setShowConditional] = useState(true);
  return (
    <TestContext.Provider value="provided-value">
      <div data-testid="parent-host">
        <TestChild name="e2e-test" count={count} />
        <TestMemoChild value="memo-test" />
        <TestForwardRefChild />
        <TestContextConsumer />
        <TestClassComponent />
        <Suspense fallback={<div data-testid="suspense-fallback">loading</div>}>
          <div data-testid="suspense-child">resolved</div>
        </Suspense>
        <Fragment>
          <div data-testid="fragment-child-a">a</div>
          <div data-testid="fragment-child-b">b</div>
        </Fragment>
        {showConditional && <div data-testid="conditional-child">conditional</div>}
        <button data-testid="increment" onClick={() => setCount((previous) => previous + 1)}>
          Increment
        </button>
        <button
          data-testid="toggle-conditional"
          onClick={() => setShowConditional((previous) => !previous)}
        >
          Toggle
        </button>
      </div>
    </TestContext.Provider>
  );
};

export const TestChild = ({ name, count }: { name: string; count: number }) => {
  return (
    <div data-testid="test-child">
      {name} {count}
    </div>
  );
};

export function MemoChild({ value }: { value: string }) {
  return <div data-testid="memo-child">{value}</div>;
}
const TestMemoChild = memo(MemoChild);

function ForwardRefChild(_: object, ref: React.ForwardedRef<HTMLDivElement>) {
  return (
    <div data-testid="forward-ref-child" ref={ref}>
      forward-ref
    </div>
  );
}
const TestForwardRefChild = forwardRef<HTMLDivElement>(ForwardRefChild);

const TestContextConsumer = () => {
  const value = useContext(TestContext);
  return <div data-testid="context-consumer">{value}</div>;
};

class TestClassComponent extends Component {
  override render() {
    return <div data-testid="class-component">class</div>;
  }
}

export const TestHarness = () => {
  useEffect(() => {
    window.__BIPPY__ = { ...bippy, ...bippySource };
  }, []);

  return <TestParent />;
};
