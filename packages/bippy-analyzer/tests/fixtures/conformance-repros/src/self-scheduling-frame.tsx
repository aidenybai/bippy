import { useEffect, useState } from "react";

export function FrameCounter() {
  const [isRunning, setIsRunning] = useState(true);
  useEffect(() => {
    if (!isRunning) return;
    let frames = 0;
    let frame = requestAnimationFrame(function tick() {
      frames += 1;
      if (frames < 60) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [isRunning]);
  return <button onClick={() => setIsRunning(!isRunning)}>{isRunning ? "Pause" : "Resume"}</button>;
}
