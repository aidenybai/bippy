import { createContext, useContext, useState } from "react";

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
