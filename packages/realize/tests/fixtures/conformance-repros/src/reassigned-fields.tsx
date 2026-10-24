import { useState } from "react";

declare function layoutCaptions(maxWords: number): { lines: string[]; nextId: number };

export const CaptionLayout = () => {
  const [lines, setLines] = useState<string[]>([]);
  const [nextLineId, setNextLineId] = useState(0);
  const layout = () => {
    let { lines: laidOut, nextId } = layoutCaptions(8);
    if (laidOut.length === 0) ({ lines: laidOut, nextId } = layoutCaptions(1));
    setLines(() => laidOut);
    setNextLineId(nextId);
  };
  return (
    <button onClick={layout}>
      {lines.length} lines, next {nextLineId}
    </button>
  );
};
