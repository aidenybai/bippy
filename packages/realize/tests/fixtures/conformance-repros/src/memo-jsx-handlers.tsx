import { useCallback, useMemo, useState } from "react";

const TOPICS = [
  { label: "news", prompt: "Show the news" },
  { label: "sports", prompt: "Show sports" },
];

export const TopicGrid = () => {
  const [topic, setTopic] = useState<string | null>(null);
  const grid = useMemo(
    () => (
      <div>
        {TOPICS.map((item) => (
          <button key={item.label} onClick={() => setTopic(item.label)}>
            {item.label}
          </button>
        ))}
      </div>
    ),
    [],
  );
  return (
    <div>
      {grid}
      <p>{topic === null ? "none" : "picked"}</p>
    </div>
  );
};

export const CallbackGrid = ({ onPick }: { onPick: (prompt: string) => void }) => {
  const [topic, setTopic] = useState<string | null>(null);
  const pick = useCallback(
    (label: string) => {
      setTopic(label);
      onPick(label);
    },
    [onPick],
  );
  const grid = useMemo(() => <button onClick={() => pick("news")}>news</button>, [pick]);
  return (
    <div>
      {grid}
      <p>{topic === null ? "none" : "picked"}</p>
    </div>
  );
};

export const FrozenToggle = () => {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = useMemo(() => <button onClick={() => setIsOpen(!isOpen)}>toggle</button>, []);
  return (
    <div>
      {toggle}
      <p>{isOpen ? "open" : "closed"}</p>
    </div>
  );
};

export const ListedHelperCallback = ({ onNext }: { onNext: () => void }) => {
  const [index, setIndex] = useState(0);
  const advance = () => {
    setIndex(1);
    onNext();
  };
  const next = useCallback(() => advance(), [advance]);
  return <button onClick={next}>{index === 0 ? "first" : "second"}</button>;
};

export const LateDeclaredClose = ({ doc }: { doc: { id: string } }) => {
  const [isOpen, setIsOpen] = useState(true);
  const start = useCallback(() => {
    if (doc.id) close();
  }, [doc.id]);
  const close = () => setIsOpen(false);
  if (!isOpen) return null;
  return <button onClick={start}>start</button>;
};
