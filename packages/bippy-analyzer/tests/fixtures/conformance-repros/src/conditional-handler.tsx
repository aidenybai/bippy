import { useState } from "react";

export const PlayResetButton = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const start = () => {
    setIsPlaying(true);
    setIsComplete(false);
  };
  const reset = () => {
    setIsPlaying(false);
    setIsComplete(true);
  };
  return (
    <button type="button" onClick={isComplete ? reset : start}>
      {isPlaying ? "Playing" : "Stopped"}
    </button>
  );
};
