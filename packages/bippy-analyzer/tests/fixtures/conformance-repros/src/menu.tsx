import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

interface MenuStore {
  selected: string | null;
  select: (value: string) => void;
  listRef: RefObject<HTMLUListElement | null>;
  register: (value: string) => void;
}

const MenuContext = createContext<MenuStore | null>(null);

export const Menu = ({ children }: { children: ReactNode }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [registered, setRegistered] = useState<string[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (registered.length > 0)
      listRef.current!.setAttribute("data-count", String(registered.length));
  }, [registered]);
  const store = useMemo<MenuStore>(
    () => ({
      selected,
      select: setSelected,
      listRef,
      register: (value) =>
        setRegistered((values) => (values.includes(value) ? values : [...values, value])),
    }),
    [selected],
  );
  return (
    <MenuContext.Provider value={store}>
      <div>{children}</div>
    </MenuContext.Provider>
  );
};

export const MenuList = ({ children }: { children: ReactNode }) => {
  const store = useContext(MenuContext)!;
  return <ul ref={store.listRef}>{children}</ul>;
};

export const MenuItem = ({ value }: { value: string }) => {
  const store = useContext(MenuContext)!;
  useEffect(() => store.register(value), [store, value]);
  return (
    <li aria-selected={store.selected === value} onClick={() => store.select(value)}>
      {value}
    </li>
  );
};
