import { useRef, useState } from "react";

interface DragState {
  startX: number;
}

export const DragInput = ({ value }: { value: number }) => {
  const [isDragging, setDragging] = useState(false);
  const stateRef = useRef<DragState>(null!);
  if (!stateRef.current) stateRef.current = { startX: value };
  return (
    <input
      value={value}
      onPointerDown={() => setDragging(true)}
      onPointerUp={() => setDragging(false)}
      data-dragging={isDragging}
    />
  );
};
