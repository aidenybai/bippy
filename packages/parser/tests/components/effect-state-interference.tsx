import { useEffect, useState } from "react";

/**
 * A module-level store written by an effect in one alternative and subscribed
 * to by the other, which re-renders when notified. The alternatives never
 * coexist, so the subscriber must never learn of a paint.
 */
let lastPainter: string | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const Canvas = () => {
  useEffect(() => {
    lastPainter = "canvas";
    notify();
  }, []);
  return <canvas />;
};

const Fallback = () => {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((version) => version + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return <p>painted by: {lastPainter ?? "nobody"}</p>;
};

const Painter = () => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  return context === null ? <Fallback /> : <Canvas />;
};

export default function EffectStateInterference() {
  return (
    <main>
      <Painter />
    </main>
  );
}

export const isPartial = true;
export const isReplayCorrected = true;
