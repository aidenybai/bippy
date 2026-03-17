import React, {
  Component,
  createContext,
  forwardRef,
  memo,
  useContext,
  useState,
} from 'react';

const TestContext = createContext('default-context');

export const TestParent = () => {
  const [count, setCount] = useState(0);
  return (
    <TestContext.Provider value="provided-value">
      <div data-testid="parent-host">
        <TestChild name="e2e-test" count={count} />
        <TestMemoChild value="memo-test" />
        <TestForwardRefChild />
        <TestContextConsumer />
        <TestClassComponent />
        <button
          data-testid="increment"
          onClick={() => setCount((previous) => previous + 1)}
        >
          Increment
        </button>
      </div>
    </TestContext.Provider>
  );
};

const TestChild = ({ name, count }: { name: string; count: number }) => {
  return (
    <div data-testid="test-child">
      {name} {count}
    </div>
  );
};

function MemoChild({ value }: { value: string }) {
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

export class TestClassComponent extends Component {
  override render() {
    return <div data-testid="class-component">class</div>;
  }
}
