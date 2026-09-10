import * as React from "react";
import { useContext, useMemo } from "react";

interface SharedContextValue {
  client?: string;
}

const contextKey = Symbol.for("__SHARED_CONTEXT__");

const getSharedContext = (): React.Context<SharedContextValue> => {
  if (!("createContext" in React)) throw new Error("no createContext");
  let context: React.Context<SharedContextValue> | undefined = React.createContext[contextKey];
  if (!context) {
    Object.defineProperty(React.createContext, contextKey, {
      value: (context = React.createContext<SharedContextValue>({})),
      enumerable: false,
      writable: false,
      configurable: true,
    });
    context.displayName = "SharedContext";
  }
  return context;
};

const invariant = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

const SharedProvider = ({ client, children }: { client: string; children: React.ReactNode }) => {
  const SharedContext = getSharedContext();
  const parent = useContext(SharedContext);
  const value = useMemo(() => ({ ...parent, client: client || parent.client }), [parent, client]);
  invariant(value.client, "missing client");
  return <SharedContext.Provider value={value}>{children}</SharedContext.Provider>;
};

const Consumer = () => {
  const { client } = useContext(getSharedContext());
  invariant(client, "missing client");
  return <p>{client}</p>;
};

const ReactApiExpando = () => (
  <SharedProvider client="apollo">
    <Consumer />
    <p>{String(React.memo.missing)}</p>
    <p>{String(getSharedContext() === getSharedContext())}</p>
  </SharedProvider>
);

export default ReactApiExpando;
