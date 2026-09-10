import { useEffect, useState, type ReactNode } from "react";

// MUI's `ButtonBase` under react-admin's `ListBase`: the list decides between
// its loading view and its rows on a query state it reads fresh on every
// render, so the decision is a new unknown each pass. The buttons on both
// sides mount a ripple from an effect; that effect ran on the alternative the
// button was committed in, and its state update belongs to that button
// unconditionally rather than staying forked on a decision the next render
// no longer recognizes.

const Ripple = () => <span className="ripple" />;

const Button = ({ children }: { children: ReactNode }) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  return (
    <button type="button">
      {children}
      {isMounted ? <Ripple /> : null}
    </button>
  );
};

const useIsPending = (): boolean => {
  const status = localStorage.getItem(window.location.hash);
  if (status === "pending") return true;
  return false;
};

export const isPartial = true;

export default function EffectsUnderUnstableDecisions() {
  const isPending = useIsPending();
  const [renderCount, setRenderCount] = useState(0);
  useEffect(() => {
    setRenderCount(1);
  }, []);
  return (
    <section data-renders={renderCount}>
      <Button>refresh</Button>
      {isPending ? <p>loading</p> : <Button>edit</Button>}
    </section>
  );
}
