import { createContext, useContext, useState } from "react";
import { EventEmitter } from "./shared/node-events";

/** `EventEmitter` reaches us through `export * from "events"`, a module the analysis never opens. */
const EmitterContext = createContext<EventEmitter | null>(null);

const useEmitter = () => {
  const emitter = useContext(EmitterContext);
  if (!emitter) throw new Error("no emitter provided");
  return emitter;
};

const Consumer = () => {
  const emitter = useEmitter();
  return <p>{typeof emitter}</p>;
};

/** A `new` of an opaque constructor is still an object, so guards on it never take the missing branch. */
export default function ExternalInstances() {
  const [emitter] = useState(() => new EventEmitter());
  return (
    <EmitterContext.Provider value={emitter}>
      {emitter ? <Consumer /> : <span>missing</span>}
    </EmitterContext.Provider>
  );
}
