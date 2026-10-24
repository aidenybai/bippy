import { useState } from "react";

export const SlicedList = () => {
  const [list, setList] = useState<number[]>([1]);
  return (
    <div>
      <button onClick={() => setList(list.slice(1))}>drop</button>
      <button onClick={() => setList(list.filter((item) => item > 0))}>keep</button>
      {list.length > 1 ? <i>many</i> : list.length === 1 ? <i>one</i> : <i>none</i>}
    </div>
  );
};
