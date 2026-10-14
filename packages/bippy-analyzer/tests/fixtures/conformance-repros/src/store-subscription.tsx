import { useEffect, useState } from "react";

const listeners = new Set<() => void>();
let storedKey: string | null = null;

const saveKey = (key: string) => {
  storedKey = key;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const KeyStatus = () => {
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => subscribe(() => setHasKey(storedKey !== null)), []);
  return (
    <div>
      <button type="button" onClick={() => saveKey("secret")}>
        Save
      </button>
      <p>{hasKey ? "Has key" : "No key"}</p>
    </div>
  );
};
