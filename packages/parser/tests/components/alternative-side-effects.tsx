import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Mantine's `ScrollArea`: each scrollbar mounts once it decides it is needed,
// its host ref registers the node with the root, and the corner renders from
// which scrollbars are registered. A ref or effect committed inside a branch
// alternative runs on that alternative only, so the state it leaves behind
// must stay conditional on the same decision instead of registering both
// scrollbars in every state.

interface ScrollAreaContextValue {
  scrollbarX: HTMLDivElement | null;
  scrollbarY: HTMLDivElement | null;
  onScrollbarXChange: (node: HTMLDivElement | null) => void;
  onScrollbarYChange: (node: HTMLDivElement | null) => void;
}

const ScrollAreaContext = createContext<ScrollAreaContextValue | null>(null);

const useScrollArea = () => {
  const context = useContext(ScrollAreaContext);
  if (!context) throw new Error("ScrollArea parts must be used within ScrollArea");
  return context;
};

const ScrollArea = ({ children }: { children: ReactNode }) => {
  const [scrollbarX, setScrollbarX] = useState<HTMLDivElement | null>(null);
  const [scrollbarY, setScrollbarY] = useState<HTMLDivElement | null>(null);
  return (
    <ScrollAreaContext.Provider
      value={{
        scrollbarX,
        scrollbarY,
        onScrollbarXChange: setScrollbarX,
        onScrollbarYChange: setScrollbarY,
      }}
    >
      <div className="root">{children}</div>
    </ScrollAreaContext.Provider>
  );
};

const ScrollbarX = () => {
  const { onScrollbarXChange } = useScrollArea();
  return <div className="scrollbar-x" ref={onScrollbarXChange} />;
};

const ScrollbarY = () => {
  const { onScrollbarYChange } = useScrollArea();
  return <div className="scrollbar-y" ref={onScrollbarYChange} />;
};

const Scrollbar = ({ orientation }: { orientation: "horizontal" | "vertical" }) => {
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    setIsVisible(orientation === "horizontal" ? window.innerWidth < 0 : window.innerHeight > 0);
  }, [orientation]);
  if (isVisible) return orientation === "horizontal" ? <ScrollbarX /> : <ScrollbarY />;
  return null;
};

const Corner = () => {
  const { scrollbarX, scrollbarY } = useScrollArea();
  if (scrollbarX && scrollbarY) return <div className="corner" />;
  if (scrollbarX || scrollbarY) return <span className="edge" />;
  return null;
};

export const isPartial = true;

export default function AlternativeSideEffects() {
  return (
    <ScrollArea>
      <p>content</p>
      <Scrollbar orientation="horizontal" />
      <Scrollbar orientation="vertical" />
      <Corner />
    </ScrollArea>
  );
}
