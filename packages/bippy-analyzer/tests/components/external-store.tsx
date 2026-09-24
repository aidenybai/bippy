import { useEffect, useSyncExternalStore } from "react";

type ToastPosition = "top-right" | "bottom-left";

interface Toast {
  id: number;
  content: string;
  position: ToastPosition;
}

/** react-toastify's store shape: a `Map` of toasts, a queue for toasts raised before a container mounts, and a cached snapshot array. */
const toasts = new Map<number, Toast>();
const listeners = new Set<() => void>();
const queue: Toast[] = [];
let snapshot: Toast[] = [];
let isContainerMounted = false;
let nextId = 1;

const notify = () => {
  snapshot = Array.from(toasts.values());
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  isContainerMounted = true;
  for (const queued of queue) toasts.set(queued.id, queued);
  queue.splice(0, queue.length);
  notify();
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => snapshot;

const toast = (content: string, position: ToastPosition) => {
  const item: Toast = { id: nextId++, content, position };
  if (!isContainerMounted) {
    queue.push(item);
    return;
  }
  toasts.set(item.id, item);
  notify();
};

const ToastContainer = () => {
  const items = useSyncExternalStore(subscribe, getSnapshot);
  const byPosition = new Map<ToastPosition, Toast[]>();
  items.forEach((item) => {
    const group = byPosition.get(item.position) ?? [];
    group.push(item);
    byPosition.set(item.position, group);
  });
  return (
    <div className="toast-container" data-count={toasts.size}>
      {Array.from(byPosition, ([position, group]) => (
        <div key={position} className={position}>
          {group.map((item) => (
            <p key={item.id}>{item.content}</p>
          ))}
        </div>
      ))}
    </div>
  );
};

const SaveButton = () => {
  useEffect(() => {
    toast("saved", "top-right");
    toast("undo available", "bottom-left");
    toast("synced", "top-right");
  }, []);
  return <button type="button">save</button>;
};

const LateToast = () => {
  useEffect(() => {
    toast("late", "bottom-left");
  }, []);
  return null;
};

const positions = new Set<ToastPosition>(["top-right", "bottom-left"]);

export default () => (
  <main>
    <SaveButton />
    <ToastContainer />
    <LateToast />
    <ul>
      {[...positions].map((position) => (
        <li key={position}>{position}</li>
      ))}
    </ul>
  </main>
);
