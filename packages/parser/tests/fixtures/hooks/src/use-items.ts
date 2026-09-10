import { useCallback, useMemo, useRef, useState } from "react";

export const useItems = (seed: string[]) => {
  const [items, setItems] = useState(seed);
  const ref = useRef(0);
  const add = useCallback((item: string) => setItems((prev) => [...prev, item]), []);
  const upper = useMemo(() => items.map((item) => item.toUpperCase()), [items]);
  return { items, upper, add, ref };
};
