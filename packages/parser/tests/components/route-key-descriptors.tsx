import { useMemo, type ReactNode } from "react";

const urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

const nanoid = (size = 21): string => {
  let id = "";
  let count = size | 0;
  while (count--) id += urlAlphabet[(Math.random() * 64) | 0];
  return id;
};

interface Route {
  name: string;
  key: string;
  params?: Record<string, string>;
  state?: { index: number };
}

interface Descriptor {
  route: Route;
  render: () => ReactNode;
  options: { title: string };
}

const CHILD_STATE = Symbol("CHILD_STATE");

const isRecordEqual = (left: Record<string, unknown>, right: Record<string, unknown>): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
};

const useRouteCache = (routes: Route[]): Route[] => {
  const cache = useMemo(() => ({ current: new Map<string, Route>() }), []);
  cache.current = routes.reduce((accumulated, route) => {
    const previous = cache.current.get(route.key);
    const { state, ...routeWithoutState } = route;
    const proxy =
      previous && isRecordEqual(previous, routeWithoutState) ? previous : routeWithoutState;
    if (proxy !== previous) {
      for (const key in proxy) {
        const value = proxy[key as keyof typeof proxy];
        Object.defineProperty(proxy, key, {
          enumerable: true,
          configurable: true,
          writable: false,
          value,
        });
      }
    }
    Object.defineProperty(proxy, CHILD_STATE, {
      enumerable: false,
      configurable: true,
      value: state,
    });
    accumulated.set(route.key, proxy);
    return accumulated;
  }, new Map<string, Route>());
  return Array.from(cache.current.values());
};

const Scene = ({ route }: { route: Route }) => (
  <section data-key-length={route.key.length}>{route.name}</section>
);

const buildDescriptors = (routes: Route[]): Record<string, Descriptor> =>
  routes.reduce<Record<string, Descriptor>>((accumulated, route) => {
    const element = <Scene route={route} key={route.key} />;
    accumulated[route.key] = {
      route,
      render() {
        return element;
      },
      options: { title: route.name.toUpperCase() },
    };
    return accumulated;
  }, {});

const withPlaceholders = (
  descriptors: Record<string, Descriptor>,
  mounted: Set<string>,
): Record<string, Descriptor> => {
  const rekeyed: Record<string, Descriptor> = {};
  for (const key in descriptors) {
    rekeyed[key] = mounted.has(key)
      ? descriptors[key]
      : { ...descriptors[key], render: () => <aside>evicted</aside> };
  }
  return rekeyed;
};

const StackView = ({
  state,
}: {
  state: { index: number; routes: Route[]; preloaded: Route[] };
}) => {
  const routes = useRouteCache(state.routes);
  const mounted = new Set(
    routes.filter((route) => route.name === "Home").map((route) => route.key),
  );
  const descriptors = withPlaceholders(buildDescriptors(routes), mounted);
  const preloadedDescriptors = state.preloaded.reduce<Record<string, Descriptor>>(
    (accumulated, route) => {
      accumulated[route.key] = accumulated[route.key] || buildDescriptors([route])[route.key];
      return accumulated;
    },
    {},
  );
  return (
    <main>
      {state.routes.concat(state.preloaded).map((route, index) => {
        const { render, options } = descriptors[route.key] ?? preloadedDescriptors[route.key];
        const isPreloaded =
          preloadedDescriptors[route.key] !== undefined && descriptors[route.key] === undefined;
        return (
          <article
            key={route.key}
            style={{ display: state.index === index && !isPreloaded ? "flex" : "none" }}
          >
            <h1>{options.title}</h1>
            {render()}
          </article>
        );
      })}
    </main>
  );
};

const initialState = {
  index: 0,
  routes: [
    { name: "Home", key: `Home-${nanoid()}`, state: { index: 0 } },
    { name: "Profile", key: `Profile-${nanoid()}` },
  ],
  preloaded: [{ name: "Settings", key: `Settings-${nanoid()}` }],
};

export const isExact = true;

export default function RouteKeyDescriptors() {
  return <StackView state={initialState} />;
}
