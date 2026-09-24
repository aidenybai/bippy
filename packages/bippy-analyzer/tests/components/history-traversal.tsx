import { useState } from "react";

/** Two text children become two HostText fibers, so the comparer checks the computed value. */
const Shown = ({ value }: { value: string }) => (
  <code>
    {"= "}
    {value}
  </code>
);

interface LocationState {
  pathname: string;
  action: string;
  listenerCount: number;
}

/** A history library's module state: it mutates only from the listeners the browser fires on traversal. */
const state: LocationState = {
  pathname: window.location.pathname,
  action: "POP",
  listenerCount: 0,
};

const handlePop = () => {
  state.pathname = window.location.pathname;
  state.action = "POP";
};

const handleHashChange = () => {
  state.action = "HASH";
};

const listen = (): (() => void) => {
  state.listenerCount += 1;
  if (state.listenerCount === 1) {
    window.addEventListener("popstate", handlePop);
    window.addEventListener("hashchange", handleHashChange);
  }
  return () => {
    state.listenerCount -= 1;
    if (state.listenerCount === 0) {
      window.removeEventListener("popstate", handlePop);
      window.removeEventListener("hashchange", handleHashChange);
    }
  };
};

const unlisten = listen();
listen();
unlisten();

const CurrentEntry = () => {
  const [entry] = useState(() => ({ ...state }));
  return (
    <section>
      <Shown value={`${entry.action}:${entry.listenerCount}`} />
      {entry.action === "POP" ? <b>initial</b> : <i>traversed</i>}
      {entry.pathname === state.pathname ? <em>same</em> : <s>moved</s>}
    </section>
  );
};

export default CurrentEntry;
