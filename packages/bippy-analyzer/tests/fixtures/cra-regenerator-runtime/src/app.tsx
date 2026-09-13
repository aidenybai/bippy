import { useAsyncDebounce } from "debounce-kit";
import { useState } from "react";

export const App = () => {
  const [filter, setFilter] = useState("");
  const onChange = useAsyncDebounce((value: string) => setFilter(value), 200);
  return (
    <section>
      <input aria-label="filter" onChange={(event) => onChange(event.target.value)} />
      <p>{filter}</p>
    </section>
  );
};
