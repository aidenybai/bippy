import { EventEmitter } from "./shared/node-events";

const emitter = new EventEmitter();

/** Comparisons against a literal the report cannot carry (`Infinity`) stay honest branches. */
export default function InfiniteLiteral() {
  const limit = emitter.getMaxListeners();
  const isUnbounded = limit === Infinity;
  const isBounded = limit < Infinity;
  return (
    <section>
      {isUnbounded ? <b>unbounded</b> : <i>bounded</i>}
      {isBounded ? <em>capped</em> : <span>open</span>}
    </section>
  );
}

export const isPartial = true;
export const stateCount = 4;
