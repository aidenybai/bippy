import { useEffect, useState } from "react";

const RouteWatcher = () => {
  const [traversals, setTraversals] = useState(0);
  const [hashChanges, setHashChanges] = useState(0);
  useEffect(() => {
    const onPopState = () => setTraversals((count) => count + 1);
    const onHashChange = () => setHashChanges((count) => count + 1);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashChange);
    window.history.pushState({ step: 1 }, "", "?step=1");
    window.history.replaceState({ step: 2 }, "", "?step=2");
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);
  return (
    <p>
      {traversals === 0 ? <b>no traversal</b> : <i>traversed</i>}
      {hashChanges === 0 ? <b>same hash</b> : <i>hash changed</i>}
    </p>
  );
};

const VisibilityWatcher = () => {
  const [isHidden, setIsHidden] = useState(false);
  useEffect(() => {
    const onVisibilityChange = () => setIsHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);
  return isHidden ? <s>hidden</s> : <u>visible</u>;
};

export default function HistoryListeners() {
  return (
    <section>
      <RouteWatcher />
      <VisibilityWatcher />
    </section>
  );
}
