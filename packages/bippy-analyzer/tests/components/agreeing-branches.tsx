import { EventEmitter } from "./shared/node-events";

/** The listener comes out of an opaque module, so nothing about it is known statically. */
const emitter = new EventEmitter();

/** spin-delay's `useSpinDelay(busy) && showSpinner` with the default `showSpinner = false`. */
const ProgressBar = ({ isSpinnerShown = false }: { isSpinnerShown?: boolean }) => {
  const pendingListener = emitter.listeners("pending")[0];
  const badge = pendingListener ? <b>busy</b> : <i>idle</i>;
  return (
    <div>
      {pendingListener && isSpinnerShown && <span className="spinner" />}
      {badge && <p>has badge</p>}
    </div>
  );
};

export const isExact = true;

export default function AgreeingBranches() {
  return <ProgressBar />;
}
