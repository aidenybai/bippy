import { useState } from "react";

const trace: string[] = [];
export const getTrace = () => trace.slice();
const InputEvent = () => {
  const [value, setValue] = useState("");
  return (
    <section>
      <input
        value={value}
        onChange={(event) => {
          trace.push(
            `${event.type}:${event.target === event.currentTarget}:${event.currentTarget.value}`,
          );
          setValue(event.currentTarget.value);
        }}
      />
      <output>{value}</output>
    </section>
  );
};
export default InputEvent;
