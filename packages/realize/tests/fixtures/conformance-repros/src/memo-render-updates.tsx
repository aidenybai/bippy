import { useMemo, useState } from "react";

export const ParsedInput = ({ text }: { text: string }) => {
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => {
    try {
      setError(null);
      return JSON.parse(text);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "invalid");
      return null;
    }
  }, [text]);
  return <div>{error ? <p>{error}</p> : <span>{String(parsed)}</span>}</div>;
};

export const SeenLabel = ({ text }: { text: string }) => {
  const [isSeen, setIsSeen] = useState(false);
  const label = useMemo(() => {
    if (text) setIsSeen(true);
    return text.toUpperCase();
  }, [text]);
  return text ? <p>{label}</p> : <span>{isSeen ? "seen" : "empty"}</span>;
};
