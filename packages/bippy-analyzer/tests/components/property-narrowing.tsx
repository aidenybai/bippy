// Tests over a plain property path (`slot.current`, react-redux's
// `childPropsFromStoreUpdate.current`) narrow that property on each side, so the
// side that reads through it never sees the alternatives the test ruled out.

interface Cache {
  label: string;
  Icon: () => React.JSX.Element;
}

interface Slot {
  current: Cache | null | undefined;
}

const Star = () => <svg />;

const readCached = (slot: Slot, isStale: boolean): string => {
  if (slot.current && !isStale) return slot.current.label.toUpperCase();
  return "fresh";
};

const Cached = ({ slot }: { slot: Slot }) => (slot.current ? <slot.current.Icon /> : <i>empty</i>);

const Missing = ({ slot }: { slot: Slot }) => {
  if (slot.current === undefined) return <s>unset</s>;
  if (slot.current === null) return <u>cleared</u>;
  return <b>{slot.current.label}</b>;
};

export default function PropertyNarrowing() {
  const hash = window.location.hash;
  const filled: Slot = { current: hash === "#filled" ? { label: "kept", Icon: Star } : undefined };
  const cleared: Slot = { current: hash === "#cleared" ? null : { label: "held", Icon: Star } };
  return (
    <div>
      <output>{readCached(cleared, false)}</output>
      <Cached slot={filled} />
      <Cached slot={cleared} />
      <Missing slot={filled} />
      <Missing slot={cleared} />
    </div>
  );
}
