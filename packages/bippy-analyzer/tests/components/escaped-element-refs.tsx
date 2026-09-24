import { type ReactNode, useCallback, useEffect, useState } from "react";
import { EventEmitter } from "./shared/node-events";

/** Renders whatever page a viewer the analysis never opens asks for; the ref on that element fires when the viewer does. */
export default function EscapedElementRefs() {
  const [viewer] = useState(() => new EventEmitter());
  const [isPageMounted, setIsPageMounted] = useState(false);
  const [slot, setSlot] = useState<ReactNode>(null);
  const handlePageRef = useCallback((node: HTMLElement | null) => {
    setIsPageMounted(node !== null);
  }, []);
  const renderPage = useCallback(
    (number: number) => <article ref={handlePageRef}>page {number}</article>,
    [handlePageRef],
  );
  useEffect(() => {
    const handlePage = (number: number) => setSlot(renderPage(number));
    viewer.on("page", handlePage);
    viewer.emit("page", 1);
    return () => {
      viewer.off("page", handlePage);
    };
  }, [viewer, renderPage]);
  return (
    <section>
      {isPageMounted ? <strong>mounted</strong> : <em>loading</em>}
      {slot}
    </section>
  );
}

export const isPartial = true;
export const minCoverage = 0.5;
