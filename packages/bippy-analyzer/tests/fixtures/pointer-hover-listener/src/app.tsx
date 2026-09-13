import { type ReactNode, useEffect, useState } from "react";
import { Presence } from "./presence";

export const HoverScrollArea = ({ children }: { children: ReactNode }) => {
  const [scrollArea, setScrollArea] = useState<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    let hideTimer = 0;
    if (scrollArea) {
      const handlePointerEnter = () => {
        window.clearTimeout(hideTimer);
        setIsVisible(true);
      };
      const handlePointerLeave = () => {
        hideTimer = window.setTimeout(() => setIsVisible(false), 600);
      };
      scrollArea.addEventListener("pointerenter", handlePointerEnter);
      scrollArea.addEventListener("pointerleave", handlePointerLeave);
      return () => {
        window.clearTimeout(hideTimer);
        scrollArea.removeEventListener("pointerenter", handlePointerEnter);
        scrollArea.removeEventListener("pointerleave", handlePointerLeave);
      };
    }
  }, [scrollArea]);
  return (
    <div className="scroll-area" ref={setScrollArea}>
      <div className="viewport">{children}</div>
      <Presence present={isVisible}>
        <div className="scrollbar" data-state={isVisible ? "visible" : "hidden"} />
      </Presence>
    </div>
  );
};

export const App = () => (
  <HoverScrollArea>
    <p>content</p>
  </HoverScrollArea>
);
