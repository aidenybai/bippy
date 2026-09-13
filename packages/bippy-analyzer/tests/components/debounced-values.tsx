import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const useDebouncedCallback = <Args extends unknown[]>(
  callback: (...args: Args) => void,
  waitMs: number,
) => {
  const latest = useRef(callback);
  const lastCallTime = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArgs = useRef<Args | null>(null);
  const isMounted = useRef(true);
  latest.current = callback;

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  return useMemo(() => {
    const invoke = () => {
      const args = pendingArgs.current;
      pendingArgs.current = null;
      if (args) latest.current.apply(null, args);
    };
    const shouldInvoke = (time: number) => {
      if (!isMounted.current) return false;
      const elapsed = time - (lastCallTime.current ?? 0);
      return lastCallTime.current === null || elapsed >= waitMs || elapsed < 0;
    };
    const onTimer = function tick() {
      const time = Date.now();
      if (shouldInvoke(time)) {
        timer.current = null;
        return invoke();
      }
      const lastCall = lastCallTime.current ?? time;
      timer.current = setTimeout(tick, waitMs - (time - lastCall));
    };
    const debounced = function (this: unknown) {
      const time = Date.now();
      pendingArgs.current = [].slice.call(arguments) as unknown as Args;
      lastCallTime.current = time;
      if (!timer.current) timer.current = setTimeout(onTimer, waitMs);
    };
    return debounced as (...args: Args) => void;
  }, [waitMs]);
};

const useDebouncedValue = <Value,>(value: Value, waitMs: number): Value => {
  const settled = useRef(value);
  const [, forceRender] = useState({});
  const previous = useRef(value);
  const update = useDebouncedCallback(
    useCallback(
      (next: Value) => {
        settled.current = next;
        forceRender({});
      },
      [forceRender],
    ),
    waitMs,
  );
  if (previous.current !== value) {
    update(value);
    previous.current = value;
  }
  return settled.current;
};

const Preview = ({ draft }: { draft: { title: string } }) => {
  const debounced = useDebouncedValue(draft, 50);
  return <output>{debounced.title === "second" ? <b /> : <s />}</output>;
};

const DebouncedValues = () => {
  const [draft, setDraft] = useState({ title: "first" });
  useEffect(() => {
    setDraft({ title: "second" });
  }, []);
  return (
    <section>
      <Preview draft={draft} />
      {[].slice.call(["a", "b"]).length === 2 ? <u /> : null}
    </section>
  );
};

export default DebouncedValues;
