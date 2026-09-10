import { useLayoutEffect, useSyncExternalStore } from "react";

interface Stream<T> {
  publish: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
  read: () => T;
}

const createStream = <T,>(initial: T): Stream<T> => {
  let current = initial;
  const listeners: (() => void)[] = [];
  return {
    publish: (value) => {
      current = value;
      listeners.slice().forEach((listener) => {
        listener();
      });
    },
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {
        listeners.splice(listeners.indexOf(listener), 1);
      };
    },
    read: () => current,
  };
};

const useStream = <T,>(stream: Stream<T>): T => useSyncExternalStore(stream.subscribe, stream.read);

const ROWS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
const COMPACT_HEIGHT = 120;
const isCompact = createStream(false);

const Rows = () => {
  const isCompactRow = useStream(isCompact);
  return (
    <ul>
      {ROWS.map((row) => {
        if (isCompactRow) return <li key={row} className="compact" />;
        return <li key={row}>{row}</li>;
      })}
    </ul>
  );
};

const Measured = ({ children }: { children: React.ReactNode }) => {
  useLayoutEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) isCompact.publish(entry.contentRect.height < COMPACT_HEIGHT);
    });
    observer.observe(document.body);
    return () => {
      observer.disconnect();
    };
  }, []);
  return <section>{children}</section>;
};

export const isPartial = true;

export default function CorrelatedGuard() {
  return (
    <Measured>
      <Rows />
    </Measured>
  );
}
