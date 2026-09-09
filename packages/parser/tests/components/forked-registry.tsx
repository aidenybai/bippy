// tippy.js's module-level `mouseMoveListeners`: every instance that hides under
// an uncertain condition reassigns the registry to a filtered copy. Joining the
// paths of many instances must stay bounded instead of doubling the registry's
// alternatives each time.

type Listener = () => number;

let listeners: Listener[] = [];

const register = (listener: Listener): void => {
  listeners.push(listener);
};

const unregister = (listener: Listener, isVisible: boolean): void => {
  if (isVisible) listeners = listeners.filter((candidate) => candidate !== listener);
};

const instances = Array.from({ length: 30 }, (_, index) => index);

export default function ForkedRegistry() {
  for (const index of instances) {
    const listener = () => index;
    register(listener);
    unregister(listener, window.innerWidth > index * 10);
  }
  return (
    <section>
      <p>{listeners.length > 0 ? "listening" : "idle"}</p>
      <p>content</p>
    </section>
  );
}
