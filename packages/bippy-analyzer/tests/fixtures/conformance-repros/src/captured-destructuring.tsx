import { useEffect, useState } from "react";

const measure = () => ({ columns: 3, rows: 2 });

export function TileCount() {
  const [tileCount, setTileCount] = useState(0);
  useEffect(() => {
    let columns = 0;
    let rows = 0;
    const remeasure = () => {
      ({ columns, rows } = measure());
    };
    remeasure();
    setTileCount(columns * rows);
  }, []);
  return <p>{tileCount > 0 ? `${tileCount} tiles` : "No tiles"}</p>;
}

export function CursorTrail() {
  const [label, setLabel] = useState("idle");
  useEffect(() => {
    let x = 0;
    let y = 0;
    const move = (event: PointerEvent) => {
      [x, [y] = [0]] = [event.clientX, [event.clientY]];
      setLabel(`${x},${y}`);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);
  return <p>{label === "idle" ? "Move the pointer" : label}</p>;
}
