import { useEffect, useState } from "react";
import { EventEmitter } from "./shared/node-events";

/** The listener comes out of an opaque module, so nothing about it is known statically. */
const emitter = new EventEmitter();

interface Failure {
  status: number;
}

const getFailure = (): Failure | undefined => emitter.listeners("fail")[0];

const Status = ({ failure, tick }: { failure: Failure | undefined; tick: number }) =>
  failure && [402, 403].includes(failure.status) ? (
    <strong data-tick={tick}>blocked</strong>
  ) : (
    <p data-tick={tick}>open</p>
  );

/**
 * Re-rendering re-evaluates the test over a fresh array literal: both `Status`
 * nodes and both commits share the one decision (`failure` present and its
 * status listed), so exactly two states exist: blocked, open.
 */
const Page = ({ failure }: { failure: Failure | undefined }) => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(1);
  }, []);
  return (
    <section>
      <Status failure={failure} tick={tick} />
      <Status failure={failure} tick={tick} />
    </section>
  );
};

export const isPartial = true;
export const stateCount = 2;

export default function RerenderedPredicate() {
  const failure = getFailure();
  return <Page failure={failure} />;
}
