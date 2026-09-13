import { useRef, type RefObject } from "react";

/**
 * A ref owned by the parent, written during render by one alternative and read
 * by the other. Only one alternative ever renders, so the reader must see the
 * initial value.
 */
const Canvas = ({ paints }: { paints: RefObject<number> }) => {
  paints.current += 1;
  return <canvas data-paints={paints.current} />;
};

const Fallback = ({ paints }: { paints: RefObject<number> }) => <p>paints: {paints.current}</p>;

const Painter = () => {
  const paints = useRef(0);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  return context ? <Canvas paints={paints} /> : <Fallback paints={paints} />;
};

export default function RefInterference() {
  return (
    <main>
      <Painter />
    </main>
  );
}

export const isPartial = true;
export const isReplayCorrected = true;
