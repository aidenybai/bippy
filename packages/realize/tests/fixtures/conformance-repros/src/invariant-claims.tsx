import { useRef, useState } from "react";

declare const invariant: (condition: unknown, message?: string) => asserts condition;

export const InvariantCount = () => {
  const [count, setCount] = useState(0);
  invariant(count < 3, "count stays small");
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
};

export const InvariantLength = ({ name }: { name: string }) => {
  invariant(name.length > 0, "name is set");
  return <p>{name}</p>;
};

export const InvariantRef = () => {
  const box = useRef<HTMLDivElement>(null);
  const measure = () => {
    invariant(box.current !== null, "box is mounted");
    return box.current.clientWidth;
  };
  return (
    <div ref={box}>
      <button onClick={() => measure()}>measure</button>
    </div>
  );
};
