import { useEffect, useRef, useState } from "react";

const HoverScrollbar = () => {
  const areaRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const onPointerEnter = () => setIsVisible(true);
    const onPointerLeave = () => setIsVisible(false);
    area.addEventListener("pointerenter", onPointerEnter);
    area.addEventListener("pointerleave", onPointerLeave);
    return () => {
      area.removeEventListener("pointerenter", onPointerEnter);
      area.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);
  return (
    <div ref={areaRef} data-state={isVisible ? "visible" : "hidden"}>
      {isVisible ? <b>scrollbar</b> : null}
    </div>
  );
};

const MoveTracker = () => {
  const [hasMoved, setHasMoved] = useState(false);
  useEffect(() => {
    const onMouseMove = () => setHasMoved(true);
    document.addEventListener("mousemove", onMouseMove);
    return () => document.removeEventListener("mousemove", onMouseMove);
  }, []);
  return hasMoved ? <em>moved</em> : <u>still</u>;
};

const ClickCounter = () => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    const onClick = () => setClicks((count) => count + 1);
    button.addEventListener("click", onClick);
    return () => button.removeEventListener("click", onClick);
  }, []);
  return (
    <button ref={buttonRef} type="button">
      {clicks === 0 ? <i>never clicked</i> : <s>clicked</s>}
    </button>
  );
};

export const isPartial = true;
export const stateCount = 5;

export default function PointerArrivalListeners() {
  return (
    <section>
      <HoverScrollbar />
      <MoveTracker />
      <ClickCounter />
    </section>
  );
}
