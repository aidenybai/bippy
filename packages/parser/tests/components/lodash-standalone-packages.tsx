import throttle from "lodash.throttle";
import { useEffect, useState } from "react";

const clock = { epoch: 1 };

/** tldraw's InputsManager: a throttled activity stamp built at construction runs its leading edge synchronously. */
class ActivityTracker {
  readonly stamp = throttle(
    () => {
      clock.epoch += 1;
    },
    1000,
    { trailing: false },
  );
}

const tracker = new ActivityTracker();

const Activity = () => {
  const [label, setLabel] = useState("idle");
  useEffect(() => {
    tracker.stamp();
    setLabel(`stamped:${clock.epoch}`);
  }, []);
  return (
    <p>
      {label === "stamped:2" ? <b>once</b> : <i>{label}</i>}
      {clock.epoch <= 2 ? <em>settled</em> : <strong>{clock.epoch}</strong>}
    </p>
  );
};

export const isExact = true;

export default function LodashStandalonePackages() {
  return (
    <section>
      <Activity />
    </section>
  );
}
