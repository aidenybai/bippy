import { useMemo } from "react";

interface Route {
  key: string;
  name: string;
}

const createRoutes = (names: string[]): Route[] =>
  names.map((name) => ({ key: `${name}-${Math.random().toString(36).slice(2)}`, name }));

const readRoutes = (): Route[] => {
  if (Math.random() > 0.5) return createRoutes(["home", "settings"]);
  const initialRoutes = createRoutes(["home"]);
  return initialRoutes;
};

const useRouteCache = (routes: Route[]): Route[] => {
  const byKey = routes.reduce((cache, route) => {
    cache.set(route.key, route);
    return cache;
  }, new Map<string, Route>());
  return Array.from(byKey.values());
};

const ForkExclusiveMapKeys = () => {
  const routes = useMemo(readRoutes, []);
  const cached = useRouteCache(routes);
  return (
    <nav data-count={cached.length}>
      {cached.map((route) => (
        <a key={route.key} href={`/${route.name}`}>
          {route.name}
        </a>
      ))}
    </nav>
  );
};

export default ForkExclusiveMapKeys;
export const isPartial = true;
