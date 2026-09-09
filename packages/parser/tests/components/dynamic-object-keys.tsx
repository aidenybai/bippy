interface Route {
  key: string;
  name: string;
}

interface Descriptor {
  route: Route;
  render: () => string;
}

const createRoute = (name: string): Route => ({ key: `${name}-${Math.random()}`, name });

const routes = [createRoute("home"), createRoute("settings"), createRoute("profile")];
const index = Math.random() < 0.5 ? 0 : 1;

const descriptors = routes.reduce<Record<string, Descriptor>>((cache, route) => {
  cache[route.key] = { route, render: () => `screen:${route.name}` };
  return cache;
}, {});

const defaults = { fallback: "none" };
const withDefaults = { ...defaults, ...descriptors };

const slot = index === 0 ? "primary" : "secondary";
const nested: Record<string, Route> = {};
nested[slot] = routes[index];
const merged = { ...nested, extra: routes[2] };

class Formatter {
  upper(text: string): string {
    return text.toUpperCase();
  }
  lower(text: string): string {
    return text.toLowerCase();
  }
  format(method: "upper" | "lower", text: string): string {
    return this[method](text);
  }
}

const formatter = new Formatter();

export const isPartial = true;

export default function DynamicObjectKeys() {
  const focused = routes[index];
  const current = descriptors[focused.key];
  const spreadCurrent = withDefaults[focused.key];
  const nestedRoute = merged[slot];
  const missing = descriptors[`${focused.name}-missing`];
  return (
    <ul>
      <li>
        {"= "}
        {current.render()}
      </li>
      <li>
        {"= "}
        {spreadCurrent.route.name}
      </li>
      <li>
        {"= "}
        {nestedRoute.name}
      </li>
      <li>
        {"= "}
        {missing === undefined ? "absent" : "present"}
      </li>
      <li>
        {"= "}
        {formatter.format(index === 0 ? "upper" : "lower", "Mixed")}
      </li>
    </ul>
  );
}
