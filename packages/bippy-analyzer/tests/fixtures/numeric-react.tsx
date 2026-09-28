import * as React from "react";
import * as TestRenderer from "react-test-renderer";

interface CounterProps {
  initial: number;
}

let renderer: ReturnType<typeof TestRenderer.create> | undefined;
let renders = 0;
const events: string[] = [];
export let currentState: number;
export const versions = [React.version, "version" in TestRenderer ? TestRenderer.version : null];

const Counter = ({ initial }: CounterProps) => {
  const [count, setCount] = React.useState(initial);
  currentState = count;
  renders++;
  React.useLayoutEffect(() => {
    events.push("commit");
    return () => {
      events.push("cleanup");
    };
  }, [count]);
  return <button onClick={() => setCount((previous) => previous + 1)}>{renders}</button>;
};

export const mount = (initial: number) => {
  renderer = TestRenderer.create(<Counter initial={initial} />);
};

export const increment = () => {
  if (!renderer) throw new Error("Missing renderer");
  const current = renderer;
  Reflect.apply(Reflect.get(current, "unstable_flushSync"), current, [
    () => current.root.findByType("button").props.onClick(),
  ]);
};

export const unmount = () => {
  if (!renderer) throw new Error("Missing renderer");
  renderer.unmount();
};

export const observe = () => JSON.stringify({ renders, events, tree: renderer?.toJSON() });
