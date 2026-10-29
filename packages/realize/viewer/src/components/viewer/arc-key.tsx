import { ArrowHead } from "./arrow-head";

const ArcSample = ({ isEvent }: { isEvent: boolean }) => (
  <svg width={22} height={8} aria-hidden>
    <path d="M 1 4 L 15 4" stroke="currentColor" strokeDasharray={isEvent ? "3 2" : undefined} />
    <ArrowHead
      from={{ x: 14, y: 4 }}
      tip={{ x: 21, y: 4 }}
      color="currentColor"
      size={6}
      isHollow={isEvent}
    />
  </svg>
);

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
