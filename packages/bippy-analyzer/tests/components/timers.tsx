import { useEffect, useRef, useState } from "react";

const TYPEWRITER_TEXT = "hi there";

/** posthog's Typewriter: a self-clearing interval advances state until the text is fully shown. */
const Typewriter = () => {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setShown((previous) => {
        if (previous >= TYPEWRITER_TEXT.length) {
          clearInterval(interval);
          return previous;
        }
        return previous + 1;
      });
    }, 20);
    return () => clearInterval(interval);
  }, []);
  const isDone = shown === TYPEWRITER_TEXT.length;
  return (
    <p>
      {TYPEWRITER_TEXT.slice(0, shown)}
      {isDone && <span className="caret" />}
    </p>
  );
};

/** An interval that measures elapsed time and stops itself once the duration has passed. */
const Progress = () => {
  const [ratio, setRatio] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= 100) {
        clearInterval(interval);
        setRatio(1);
      } else setRatio(elapsed / 100);
    }, 16);
    return () => clearInterval(interval);
  }, []);
  return ratio >= 1 ? <strong>done</strong> : <progress value={ratio} />;
};

/** The timeout handle is assigned after `setTimeout` returns; the callback runs later and reads it. */
const HandleReader = () => {
  const [label, setLabel] = useState("pending");
  useEffect(() => {
    const timeout = setTimeout(() => {
      setLabel(typeof timeout === "number" ? "fired" : "fired late");
    }, 0);
    return () => clearTimeout(timeout);
  }, []);
  return <em>{label}</em>;
};

/** A timeout cleared before it fires never updates state. */
const Cancelled = () => {
  const [isVisible, setIsVisible] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    timeoutRef.current = setTimeout(() => setIsVisible(false), 10);
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
  }, []);
  return isVisible ? <b>still here</b> : null;
};

/** Keyboard and pointer listeners do not fire before the snapshot is taken. */
const Listeners = () => {
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => setPressedKey(event.key);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", () => setPressedKey("pointer"));
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return <output>{pressedKey ? <kbd>{pressedKey}</kbd> : <span>no key</span>}</output>;
};

export default () => (
  <section>
    <Typewriter />
    <Progress />
    <HandleReader />
    <Cancelled />
    <Listeners />
  </section>
);
