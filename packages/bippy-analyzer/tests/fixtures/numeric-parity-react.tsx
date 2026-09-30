import * as React from "react";
import * as TestRenderer from "react-test-renderer";

interface CounterProps {
  step: number;
}

let renderer: ReturnType<typeof TestRenderer.create> | undefined;
const events: string[] = [];
export let currentState = 0;

const Counter = ({ step }: CounterProps) => {
  const [count, setCount] = React.useState(0);
  currentState = count;
  const parity = count % 2 === 0 ? "even" : "odd";
  React.useLayoutEffect(() => {
    events.push(`layout:${parity}`);
    return () => {
      events.push(`cleanup:${parity}`);
    };
  }, [count]);
  return (
    <section>
      <output>{parity}</output>
      <button id="step" onClick={() => setCount((previous) => previous + step)}>
        step
      </button>
      <button id="five" onClick={() => setCount((previous) => previous + 5)}>
        five
      </button>
      <button id="reset" onClick={() => setCount(0)}>
        reset
      </button>
      <button id="subtract" onClick={() => setCount((previous) => previous - 5)}>
        subtract
      </button>
    </section>
  );
};

export const mount = (step: number) => {
  renderer = TestRenderer.create(<Counter step={step} />);
};
export const dispatch = (id: string) => {
  if (!renderer) throw new Error("Missing renderer");
  const current = renderer;
  Reflect.apply(Reflect.get(current, "unstable_flushSync"), current, [
    () => current.root.findByProps({ id }).props.onClick(),
  ]);
};
export const unmount = () => {
  renderer?.unmount();
};
export const observe = () => JSON.stringify({ events, tree: renderer?.toJSON() });
