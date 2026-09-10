import { useLayoutEffect, useSyncExternalStore } from "react";

interface Stream<T> {
  publish: (value: T) => void;
  subscribe: (listener: (value: T) => void) => () => void;
  read: () => T;
}

/** urx's `statefulStream`: listeners are kept in a plain array and called on publish. */
const createStream = <T,>(initial: T): Stream<T> => {
  let current = initial;
  const listeners: ((value: T) => void)[] = [];
  return {
    publish: (value) => {
      current = value;
      listeners.slice().forEach((listener) => {
        listener(value);
      });
    },
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index > -1) listeners.splice(index, 1);
      };
    },
    read: () => current,
  };
};

const useStream = <T,>(stream: Stream<T>): T =>
  useSyncExternalStore((onStoreChange) => stream.subscribe(() => onStoreChange()), stream.read);

const ITEM_HEIGHT = 30;
const viewportHeight = createStream(0);
const visibleCount = createStream(3);

/** react-virtuoso's `Viewport`: the observer publishes the measured height into the system, which derives the visible range. */
const MeasuredViewport = ({ children }: { children: React.ReactNode }) => {
  useLayoutEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      viewportHeight.publish(entry.contentRect.height);
      visibleCount.publish(Math.ceil(entry.contentRect.height / ITEM_HEIGHT));
    });
    observer.observe(document.body);
    return () => {
      observer.disconnect();
    };
  }, []);
  const height = useStream(viewportHeight);
  return <section data-height={height}>{children}</section>;
};

const Items = () => {
  const count = useStream(visibleCount);
  return (
    <ul>
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>{index}</li>
      ))}
    </ul>
  );
};

export const isPartial = true;

export default function ObservedStore() {
  return (
    <MeasuredViewport>
      <Items />
    </MeasuredViewport>
  );
}
