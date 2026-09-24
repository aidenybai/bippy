import { createContext, type ReactNode, useContext } from "react";

interface ScopedContext<T> {
  readonly Provider: (props: { value: T; children: ReactNode }) => ReactNode;
  readonly useScoped: () => T;
}

const createScopedContext = <T,>(name: string): ScopedContext<T> => {
  const Context = createContext<T | null>(null);
  Context.displayName = `${name}Context`;
  const Provider = ({ value, children }: { value: T; children: ReactNode }) => (
    <Context.Provider value={value}>{children}</Context.Provider>
  );
  const useScoped = (): T => {
    const value = useContext(Context);
    if (value === null) throw new Error(`${name} used outside its provider`);
    return value;
  };
  return { Provider, useScoped };
};

const createScopedPair = <T,>(name: string) => {
  const { Provider, useScoped } = createScopedContext<T>(name);
  return [Provider, useScoped] as const;
};

export const [DialogProvider, useDialogContext] = createScopedPair<{ isOpen: boolean }>("Dialog");

const { Provider: PanelProvider, useScoped: usePanelContext } = createScopedContext<{
  count: number;
}>("Panel");

const DialogContent = () => {
  const { isOpen } = useDialogContext();
  return isOpen ? <section>open</section> : null;
};

const PanelBadge = () => {
  const { count } = usePanelContext();
  return count > 0 ? <mark>{count}</mark> : <small>empty</small>;
};

export const Scoped = () => (
  <DialogProvider value={{ isOpen: false }}>
    <DialogContent />
    <PanelProvider value={{ count: 2 }}>
      <PanelBadge />
    </PanelProvider>
  </DialogProvider>
);
