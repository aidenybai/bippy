import { useState } from "react";

export const SomeSetterAfterUpdate = () => {
  const [count, setCount] = useState(1);
  const [items, setItems] = useState<number[]>([2, 3]);
  const reset = () =>
    items.some((item) => {
      if (item >= count) {
        setCount(0);
        return true;
      }
      return false;
    });
  return (
    <div>
      {count > 3 ? <i>high</i> : <i>low</i>}
      <button onClick={reset}>reset</button>
      <button onClick={() => setCount(count + 2)}>raise</button>
      <button onClick={() => setItems([9])}>replace</button>
    </div>
  );
};

export const DerivedSetterAfterUpdate = () => {
  const [count, setCount] = useState(5);
  const [items, setItems] = useState<number[]>([1]);
  const large = items.filter((item) => item > 1);
  const reset = () =>
    large.findIndex((item) => {
      if (item === count) setCount(0);
      return false;
    });
  return (
    <div>
      {count > 3 ? <i>high</i> : <i>low</i>}
      <button onClick={reset}>reset</button>
      <button onClick={() => setItems([0, 5])}>replace</button>
    </div>
  );
};
