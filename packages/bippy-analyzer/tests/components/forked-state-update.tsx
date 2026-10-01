import { type ReactNode, useLayoutEffect, useState } from "react";

// Radix's `usePresence`: a layout effect drives a state machine from `present`.
// When `present` is uncertain the update queued on each path of the `if` must
// stay on that path, so the mounted state joins to a branch instead of keeping
// whichever path ran last.

type PresenceState = "mounted" | "unmounted";

const Presence = ({ present, children }: { present: boolean; children: ReactNode }) => {
  const [state, setState] = useState<PresenceState>(present ? "mounted" : "unmounted");
  useLayoutEffect(() => {
    if (present) setState("mounted");
    else setState("unmounted");
  }, [present]);
  return state === "mounted" ? <>{children}</> : null;
};

export default function ForkedStateUpdate() {
  const isWide = window.innerWidth > 100;
  return (
    <section>
      <Presence present={isWide}>
        <aside>wide layout</aside>
      </Presence>
      <p>content</p>
    </section>
  );
}

export const minCoverage = 0.5;
