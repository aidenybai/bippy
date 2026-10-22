import { useRef, useState } from "react";

export function PointerBadge() {
  const [isTracking, setIsTracking] = useState(false);
  const position = useRef({ x: 0, y: 0 });
  const pointer = {
    get x() {
      return position.current.x;
    },
    set x(value: number) {
      position.current.x = value;
    },
    label: "pointer",
  };
  return (
    <button onClick={() => setIsTracking(!isTracking)}>
      {isTracking ? `${pointer.label} at ${pointer.x}` : "Track pointer"}
    </button>
  );
}
