interface Route {
  key: string;
  name: string;
}

const createRoute = (name: string): Route => ({ key: `${name}-${Math.random()}`, name });

const initialRoutes = [createRoute("home"), createRoute("settings")];
const restoredRoutes = [createRoute("profile")];

const RouteList = ({ routes }: { routes: Route[] }) => {
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
      <li>{byKey.has(initialRoutes[0].key) ? "initial" : "restored"}</li>
      <li>{byKey.get(restoredRoutes[0].key)?.name ?? "none"}</li>
    </ul>
  );
};

export const isPartial = true;

export default function BranchReceiverMutations() {
  const isRestored = Math.random() < 0.5;
  return <RouteList routes={isRestored ? restoredRoutes : initialRoutes} />;
}
