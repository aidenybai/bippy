import { useMemo } from "react";

const createId = (): string => Math.random().toString(36).slice(2);

interface Route {
  key: string;
  name: string;
}

const NAMES = ["home", "login", "settings"];

const PrefixedDynamicMapKeys = () => {
  const routes = useMemo(
    () => NAMES.map((name): Route => ({ key: `${name}-${createId()}`, name })),
    [],
  );
  const byKey = routes.reduce((cache, route) => {
    cache.set(route.key, route);
    return cache;
  }, new Map<string, Route>());
  const ordered = Array.from(byKey.values());
  return (
    <ul>
      {ordered.map((route) => (
        <li key={route.key}>{route.name}</li>
      ))}
    </ul>
  );
};

export default PrefixedDynamicMapKeys;
export const isExact = true;
