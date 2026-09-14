import { useEffect, useState } from "react";

const RELAY_HOPS = 12;

/** A slow interval refreshing an elapsed-time label has not ticked when the snapshot is taken. */
const SavedAgo = () => {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [, setNow] = useState(0);
  useEffect(() => {
    const timeout = setTimeout(() => setSavedAt(Date.now()), 10);
    return () => clearTimeout(timeout);
  }, []);
  useEffect(() => {
    if (!savedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [savedAt]);
  if (!savedAt) return <i>unsaved</i>;
  const secondsAgo = Math.round((Date.now() - savedAt) / 1000);
  return secondsAgo < 60 ? <b>just now</b> : <time>{Math.floor(secondsAgo / 60)}m ago</time>;
};

/** Each hop's effect schedules the next timer, so the chain outlives a fixed number of settle rounds. */
const Relay = () => {
  const [hop, setHop] = useState(0);
  useEffect(() => {
    if (hop >= RELAY_HOPS) return;
    const timeout = setTimeout(() => setHop(hop + 1), 0);
    return () => clearTimeout(timeout);
  }, [hop]);
  return hop >= RELAY_HOPS ? <output>arrived</output> : <progress value={hop} max={RELAY_HOPS} />;
};

export const App = () => (
  <main>
    <SavedAgo />
    <Relay />
  </main>
);
