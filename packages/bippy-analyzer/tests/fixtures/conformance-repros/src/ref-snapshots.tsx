import { useRef, useState } from "react";

declare const save: () => Promise<void>;

export const RefSnapshot = () => {
  const [status, setStatus] = useState<"idle" | "saved" | "stale">("idle");
  const request = useRef(0);
  const handleSave = async () => {
    request.current = request.current + 1;
    const id = request.current;
    await save();
    if (request.current !== id) {
      setStatus("stale");
      return;
    }
    setStatus("saved");
  };
  return <button onClick={handleSave}>{status}</button>;
};

export const IncrementedId = () => {
  const [status, setStatus] = useState("idle");
  const request = useRef(0);
  const handleSave = async () => {
    const id = ++request.current;
    await save();
    if (request.current !== id) return;
    setStatus("saved");
  };
  return <button onClick={handleSave}>{status}</button>;
};

export const StoreAfterAwait = () => {
  const [status, setStatus] = useState("idle");
  const request = useRef(0);
  const handleSave = async () => {
    await save();
    request.current = 1;
    if (request.current === 1) setStatus("saved");
  };
  return <button onClick={handleSave}>{status}</button>;
};

declare const onChange: () => void;

export const SyncSnapshot = () => {
  const [status, setStatus] = useState("idle");
  const count = useRef(0);
  const handleChange = () => {
    const before = count.current;
    onChange();
    setStatus(count.current === before ? "same" : "changed");
  };
  return <button onClick={handleChange}>{status}</button>;
};
