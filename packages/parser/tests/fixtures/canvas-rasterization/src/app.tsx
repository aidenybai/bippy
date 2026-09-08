import { useLayoutEffect, useRef, useState } from "react";

const MEASURE_FONT = "12px sans-serif";

const measureText = (text: string): number | null => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.font = MEASURE_FONT;
  return context.measureText(text).width;
};

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [labelWidth] = useState(() => measureText("label"));
  const [hasContext, setHasContext] = useState(false);
  useLayoutEffect(() => {
    setHasContext(canvasRef.current?.getContext("2d") !== null);
  }, []);
  return (
    <main>
      <canvas ref={canvasRef} width={10} height={10} />
      {labelWidth === null ? <p>unmeasured</p> : <output>{labelWidth}</output>}
      {hasContext ? <b>context</b> : <i>no context</i>}
    </main>
  );
};
