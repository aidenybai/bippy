import * as React from "react";
import * as TestRenderer from "react-test-renderer";

let renderer: ReturnType<typeof TestRenderer.create> | undefined;
let dispatch: React.Dispatch<React.SetStateAction<number>> | undefined;

const Counter = () => {
  const [count, setCount] = React.useState(0);
  dispatch = setCount;
  return <output>{count}</output>;
};

export const mount = () => {
  renderer = TestRenderer.create(<Counter />);
};
export const getDispatch = () => dispatch;
export const increment = () => dispatch?.((count) => count + 1);
export const observe = () => JSON.stringify(renderer?.toJSON());
export const unmount = () => renderer?.unmount();
