import { startTransition as startStandalone, useRef, useState, useTransition } from "react";

export const HookTransition = () => {
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | undefined>(undefined);
  return (
    <button disabled={isPending} onClick={() => startTransition(() => setSelected("a"))}>
      {selected}
    </button>
  );
};

export const StandaloneTransition = () => {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  return <button onClick={() => startStandalone(() => setSelected("a"))}>{selected}</button>;
};

export const RefTransition = () => {
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState("");
  const isScrolling = useRef(false);
  return (
    <button
      onClick={() => {
        isScrolling.current = true;
        startTransition(() => setSelected("b"));
      }}
    >
      {selected}
    </button>
  );
};
