import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

export const ColonText = () => {
  const [label, setLabel] = useState("start");
  return (
    <div>
      <button onClick={() => setLabel("x")}>save: now</button>
      {label === "x" ? <p>time: 12:30</p> : <p>no</p>}
    </div>
  );
};

const SetOpenContext = createContext<(isOpen: boolean) => void>(() => {});

const OpenButton = () => {
  const setOpen = useContext(SetOpenContext);
  return <button onClick={() => setOpen(true)}>open</button>;
};

export const ProviderBesideButton = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <SetOpenContext.Provider value={setIsOpen}>
      <OpenButton />
      <button onClick={() => setCount(count + 1)}>increment</button>
      {isOpen ? <p>open</p> : <p>closed</p>}
    </SetOpenContext.Provider>
  );
};

export const QuotedText = () => {
  const [isSaid, setIsSaid] = useState(false);
  return (
    <div>
      <button onClick={() => setIsSaid(true)}>say "hi" \ now</button>
      {isSaid ? <p>said</p> : <p>quiet</p>}
    </div>
  );
};

export const SizeSelect = () => {
  const [size, setSize] = useState("small");
  return (
    <div>
      <select value={size} onChange={(event) => setSize(event.target.value)}>
        <option value="small">small</option>
        <option value="large">large</option>
      </select>
      {size === "large" ? <p>big</p> : <p>little</p>}
    </div>
  );
};

export const LoopPickedOption = () => {
  const [picked, setPicked] = useState(-1);
  const options: ReactNode[] = [];
  for (let index = 0; index < 2; index++)
    options.push(
      <button key={index} onClick={() => setPicked(index)}>
        {index === 0 ? "first" : "second"}
      </button>,
    );
  return (
    <div>
      {picked === -1 ? <p>none</p> : picked === 0 ? <p>first</p> : <p>second</p>}
      {options}
    </div>
  );
};
