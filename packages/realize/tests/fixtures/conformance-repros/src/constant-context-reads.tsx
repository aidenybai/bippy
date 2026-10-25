import { useEffect, useState } from "react";

export const DeclaredLater = ({ initial }: { initial?: string }) => {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    if (initial) setTimeout(() => append(initial), 100);
  }, [initial]);
  const append = (item: string) => setItems((previous) => [...previous, item]);
  return <p>{items.length === 0 ? "empty" : "filled"}</p>;
};

export const RecursiveRetry = () => {
  const [status, setStatus] = useState("ok");
  useEffect(() => {
    const attempt = (retries: number) => {
      if (retries > 0) attempt(retries - 1);
      else setStatus("failed");
    };
    setTimeout(() => attempt(1), 100);
  }, []);
  return <p>{status === "ok" ? "ok" : "failed"}</p>;
};

export const CloseAfterAwait = () => {
  const [isOpen, setIsOpen] = useState(true);
  const start = async () => {
    await fetch("/export");
    close();
  };
  const close = () => setIsOpen(false);
  if (!isOpen) return null;
  return <button onClick={start}>start</button>;
};
