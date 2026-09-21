import { useEffect, useRef, useState } from "react";

const isLocked = Boolean(document.createElement("canvas").getContext("2d"));

export const isPartial = true;
export const isEnumerated = true;

export default () => {
  const settings = useRef({ count: 0 });
  const [outcome, setOutcome] = useState("pending");

  useEffect(() => {
    if (isLocked) Object.freeze(settings.current);
    else Object.seal(settings.current);
    try {
      settings.current.count += 1;
      setOutcome("writable");
    } catch {
      setOutcome("readonly");
    }
  }, []);

  const descriptor = Object.getOwnPropertyDescriptor(settings.current, "count");
  return (
    <main>
      {outcome === "pending" ? (
        <em>loading</em>
      ) : outcome === "readonly" ? (
        <strong>locked</strong>
      ) : (
        <span>editable</span>
      )}
      <p>{settings.current.count}</p>
      {Object.isExtensible(settings.current) ? <button>open</button> : <small>closed</small>}
      {descriptor?.writable ? <b>writable</b> : <i>readonly</i>}
    </main>
  );
};
