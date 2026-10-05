import { useEffect, useState, type ReactNode } from "react";

interface Shared {
  value: number;
  self?: Shared;
  read: () => number;
}
const shared: Shared = {
  value: 1,
  read() {
    return this.value;
  },
};
shared.self = shared;
const callback = () => {
  shared.value++;
};
const trace: string[] = [];
export const getTrace = () => trace.slice();
interface ChildProps {
  first: Shared;
  second: Shared;
  run: () => void;
  children: ReactNode;
}
const children = [<i key="child">child</i>];
const Child = (props: ChildProps) => {
  props.run();
  trace.push(`child:${props.first.read()}`);
  return (
    <output>
      {String(props.first === props.second)}:{String(props.first.self === props.first)}:
      {props.first.read()}:{String(props.run === callback)}:{String(props.children === children)}:
      {String(Object.isFrozen(props))}
      {props.children}
    </output>
  );
};
const PropIdentity = () => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(1);
  }, []);
  return (
    <section data-count={count}>
      <Child first={shared} second={shared} run={callback}>
        {children}
      </Child>
    </section>
  );
};
export default PropIdentity;
