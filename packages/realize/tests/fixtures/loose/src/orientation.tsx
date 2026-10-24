import { useState } from "react";

type Orientation = "portrait" | "landscape";

export const ReplayFrame = ({ onReset }: { onReset: (reset: () => void) => void }) => {
  const [orientation, setOrientation] = useState<Orientation | null>(null);
  onReset(() => setOrientation(null));
  return (
    <div>
      <button onClick={() => setOrientation("portrait")}>Portrait</button>
      <p>{orientation === "portrait" ? "tall" : "wide"}</p>
      <span>{(orientation === "portrait" ? orientation : null) as Orientation}</span>
    </div>
  );
};
