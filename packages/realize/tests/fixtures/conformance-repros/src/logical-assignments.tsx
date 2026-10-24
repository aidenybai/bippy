import { useRef, useState } from "react";

export const DraftTitle = ({ initialTitle }: { initialTitle?: string }) => {
  const [title, setTitle] = useState(initialTitle);
  let label = title;
  label ??= "Untitled";
  return (
    <button onClick={() => setTitle("Draft")}>
      {label === "Untitled" ? "Name this draft" : label}
    </button>
  );
};

export const DraftTitleSpelledOut = ({ initialTitle }: { initialTitle?: string }) => {
  const [title, setTitle] = useState(initialTitle);
  let label = title;
  label = label ?? "Untitled";
  return (
    <button onClick={() => setTitle("Draft")}>
      {label === "Untitled" ? "Name this draft" : label}
    </button>
  );
};

export const SeenCounter = ({ ids }: { ids: string[] }) => {
  const seen = useRef<Record<string, number>>({});
  const [isCompact, setIsCompact] = useState(false);
  for (const id of ids) seen.current[id] ||= Date.now();
  let summary = isCompact && "compact";
  summary &&= summary.toUpperCase();
  return <p onClick={() => setIsCompact(!isCompact)}>{summary || "Expanded"}</p>;
};

export const SeenCounterSpelledOut = ({ ids }: { ids: string[] }) => {
  const seen = useRef<Record<string, number>>({});
  const [isCompact, setIsCompact] = useState(false);
  for (const id of ids) seen.current[id] = seen.current[id] || Date.now();
  let summary = isCompact && "compact";
  summary = summary && summary.toUpperCase();
  return <p onClick={() => setIsCompact(!isCompact)}>{summary || "Expanded"}</p>;
};
