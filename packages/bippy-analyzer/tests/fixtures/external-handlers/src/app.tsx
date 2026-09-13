import { useState } from "react";
import { Button, Field } from "ui-kit";

const Counter = () => {
  const [count, setCount] = useState(0);
  return (
    <section>
      <Button onClick={() => setCount(count + 1)} onPointerDownCapture={() => setCount(0)}>
        increment
      </Button>
      {count === 0 ? <em>none</em> : <strong>{count}</strong>}
    </section>
  );
};

const Trimmed = () => {
  const [trimmed, setTrimmed] = useState("");
  return (
    <section>
      <Field value=" padded " onChange={setTrimmed} />
      {trimmed === "" ? <em>empty</em> : <code>{trimmed}</code>}
    </section>
  );
};

export const App = () => (
  <main>
    <Counter />
    <Trimmed />
  </main>
);
