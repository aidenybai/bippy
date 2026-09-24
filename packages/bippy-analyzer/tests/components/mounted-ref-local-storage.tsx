import { useCallback, useEffect, useRef, useState } from "react";

const useIsMounted = () => {
  const mountedRef = useRef(false);
  const isMounted = useCallback(() => mountedRef.current, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return isMounted;
};

const readItem = (key: string): unknown => {
  try {
    const itemValue = localStorage.getItem(key);
    if (typeof itemValue === "string") return JSON.parse(itemValue);
    return undefined;
  } catch {
    return undefined;
  }
};

const useLocalStorage = (key: string, defaultValue: unknown): unknown => {
  const [value, setValue] = useState<unknown>();
  useEffect(() => {
    const initialValue = readItem(key);
    if (typeof initialValue === "undefined" || initialValue === null) {
      setValue(defaultValue);
    } else {
      setValue(initialValue);
    }
  }, [defaultValue, key]);
  return value;
};

export const isExact = true;

export default function Devtools() {
  const isOpen = useLocalStorage("devtoolsOpen", false);
  const [isResolvedOpen, setIsResolvedOpen] = useState(false);
  const isMounted = useIsMounted();
  useEffect(() => {
    setIsResolvedOpen(isOpen === true);
  }, [isOpen]);
  if (!isMounted()) return null;
  return (
    <aside>
      <p>{isResolvedOpen ? "open" : "closed"}</p>
      {!isResolvedOpen ? <button type="button">Open</button> : null}
    </aside>
  );
}
