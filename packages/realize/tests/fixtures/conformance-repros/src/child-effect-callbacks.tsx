import { forwardRef, memo, useEffect, useState } from "react";
import DefaultAnnouncer from "./default-announcer";

const Announcer = ({ onMount }: { onMount: () => void }) => {
  useEffect(() => {
    onMount();
  }, []);
  return <b>child</b>;
};

const Picker = ({ onPick }: { onPick: () => void }) => <button onClick={onPick}>pick</button>;

export const MountedAnnouncer = () => {
  const [isShown, setIsShown] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <div>
      {isShown && <Announcer onMount={() => setCount(1)} />}
      {isShown && count === 1 ? <i>both</i> : isShown ? <i>shown</i> : <i>hidden</i>}
      <button onClick={() => setIsShown(!isShown)}>flip</button>
    </div>
  );
};

export const MountedPicker = () => {
  const [isShown, setIsShown] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <div>
      {isShown && <Picker onPick={() => setCount(1)} />}
      {isShown && count === 1 ? <i>both</i> : isShown ? <i>shown</i> : <i>hidden</i>}
      <button onClick={() => setIsShown(!isShown)}>flip</button>
    </div>
  );
};

const MemoAnnouncer = memo(({ onMount }: { onMount: () => void }) => {
  useEffect(() => {
    onMount();
  }, []);
  return <b>child</b>;
});

const RefAnnouncer = forwardRef<HTMLElement, { onMount: () => void }>(({ onMount }, ref) => {
  useEffect(() => {
    onMount();
  }, []);
  return <b ref={ref}>child</b>;
});

export const WrappedAnnouncers = () => {
  const [isShown, setIsShown] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <div>
      {isShown && <MemoAnnouncer onMount={() => setCount(1)} />}
      {isShown && <RefAnnouncer onMount={() => setCount(2)} />}
      {isShown && <DefaultAnnouncer onMount={() => setCount(3)} />}
      {count === 0 ? <i>none</i> : <i>some</i>}
      <button onClick={() => setIsShown(!isShown)}>flip</button>
    </div>
  );
};
