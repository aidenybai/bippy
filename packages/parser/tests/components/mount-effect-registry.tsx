import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface Registry {
  add: (name: string) => void;
  clear: () => void;
}

const NamesContext = createContext<string[]>([]);
const RegistryContext = createContext<Registry>({ add: () => {}, clear: () => {} });

const RegistryProvider = ({ children }: { children: React.ReactNode }) => {
  const [names, setNames] = useState<string[]>([]);
  const add = useCallback((name: string) => {
    setNames((previous) => [...previous, name]);
  }, []);
  const clear = useCallback(() => {
    setNames([]);
  }, []);
  const registry = useMemo(() => ({ add, clear }), [add, clear]);
  return (
    <NamesContext.Provider value={names}>
      <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
    </NamesContext.Provider>
  );
};

const Field = ({ name }: { name: string }) => {
  const { add } = useContext(RegistryContext);
  useEffect(() => {
    add(name);
  }, [add, name]);
  return <input name={name} />;
};

const Summary = () => {
  const names = useContext(NamesContext);
  return (
    <ul>
      {names.map((name) => (
        <li key={name}>{name}</li>
      ))}
    </ul>
  );
};

const Form = () => {
  const { clear } = useContext(RegistryContext);
  useEffect(() => {
    clear();
  }, [clear]);
  return (
    <form>
      <Field name="width" />
      <Field name="height" />
      <Field name="color" />
      <Summary />
    </form>
  );
};

export const isExact = true;

export default function MountEffectRegistry() {
  return (
    <RegistryProvider>
      <Form />
    </RegistryProvider>
  );
}
