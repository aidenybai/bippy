import { useState } from "react";

const useToggle = (initial: boolean) => {
  const [value, setValue] = useState(initial);
  return { value, flip: () => setValue(!value) };
};

const useTupleToggle = (): [boolean, () => void] => {
  const [value, setValue] = useState(false);
  return [value, () => setValue(!value)];
};

export const TwoInstances = () => {
  const first = useToggle(false);
  const second = useToggle(false);
  return (
    <div>
      <button onClick={first.flip}>go</button>
      {first.value && !second.value ? <i>firstonly</i> : null}
      {second.value ? <i>Z1</i> : null}
    </div>
  );
};

export const DifferentInitials = () => {
  const first = useToggle(false);
  const second = useToggle(true);
  return (
    <div>
      <button onClick={first.flip}>go</button>
      {second.value ? <i>secondon</i> : <i>Z1</i>}
      {first.value ? <i>firston</i> : null}
    </div>
  );
};

export const TwoTuples = () => {
  const [a, flipA] = useTupleToggle();
  const [b] = useTupleToggle();
  return (
    <div>
      <button onClick={flipA}>go</button>
      {a && !b ? <i>aonly</i> : null}
      {b ? <i>Z1</i> : null}
    </div>
  );
};
