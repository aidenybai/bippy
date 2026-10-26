import { useEffect, useState } from "react";

export const LoadTimeout = () => {
  const [hasTimedOut, setHasTimedOut] = useState(false);
  useEffect(() => {
    let isPlaying = false;
    window.addEventListener("play", () => {
      isPlaying = true;
    });
    setTimeout(() => {
      if (!isPlaying) setHasTimedOut(true);
    }, 1000);
  }, []);
  return <p>{hasTimedOut ? "timed out" : "loading"}</p>;
};
