// @ts-nocheck
import { forwardRef, memo, useState } from "react";

const useOptional: (() => void) | undefined = undefined;

export const Memoized = memo(({ label }: { label: string }) => <span>{label}</span>);

export default memo(() => <span>anonymous</span>);

export const Forwarded = forwardRef<HTMLDivElement>((_props, ref) => <div ref={ref} />);

export const makeCounter = (initial: number) => {
  const Counter = () => {
    const [count, setCount] = useState(initial);
    return <button onClick={() => setCount(count + 1)}>{count}</button>;
  };
  return Counter;
};

export const optedIn = (value: number) => {
  "use memo";
  return value * 2;
};

export function NotAComponent() {
  useOptional?.();
  return null;
}

export class Widget {
  render() {
    const Inner = () => <div />;
    return Inner;
  }
}

export let Reassigned = null;
Reassigned = () => <span />;

export const variants = [memo(() => <span>variant</span>)];
