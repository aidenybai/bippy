import { useId } from "react";
import { ArrowMarker } from "./arrow-marker";

const ArcSample = ({ isEvent }: { isEvent: boolean }) => {
  const markerId = useId();
  return (
    <svg width={22} height={8} aria-hidden>
      <defs>
        <ArrowMarker id={markerId} size={6} isHollow={isEvent} />
      </defs>
      <path
        d="M 1 4 L 21 4"
        stroke="currentColor"
        strokeDasharray={isEvent ? "3 2" : undefined}
        markerEnd={`url(#${markerId})`}
      />
    </svg>
  );
};

export const ArcKey = () => (
  <div className="hidden shrink-0 items-center gap-3 sm:flex">
    <span className="flex items-center gap-1.5">
      <ArcSample isEvent={false} />
      during render
    </span>
    <span className="flex items-center gap-1.5">
      <ArcSample isEvent />
      on event
    </span>
  </div>
);
