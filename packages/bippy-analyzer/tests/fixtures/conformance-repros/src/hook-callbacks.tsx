import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export const Overlay = ({ container }: { container?: Element | null }) => {
  const [mounted, setMounted] = useState(false);
  useIsomorphicLayoutEffect(() => setMounted(true), []);
  const target = container ?? (mounted ? document.body : null);
  return target ? createPortal(<p>overlay</p>, target) : null;
};
